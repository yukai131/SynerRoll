using Test

# Real solver regressions use an isolated data root and never touch user tasks.
const FLOW_DATA_ROOT = mktempdir(; cleanup=false)
ENV["SYNERROLL_DATA_DIR"] = FLOW_DATA_ROOT
ENV["SYNERROLL_CAPACITY_WORKER"] = "1"
include(joinpath(@__DIR__, "server.jl"))

const FLOW_LIBRARY = JSON3.read(read(joinpath(@__DIR__, "../config/component-library.json"), String), Dict{String,Any})["components"]
function flow_node(id, key; boundaries=String[])
    schema = FLOW_LIBRARY[key]
    defaults(section) = Dict{String,Any}(field["key"] => get(field, "defaultValue", nothing) for field in get(schema, section, []))
    tech = defaults("commonTechFields")
    haskey(tech, "capacity") && (tech["capacity"] = 1000.0)
    settings = Dict{String,Any}("status" => "stand_alone", "techParams" => defaults("layerTechFields"),
        "economicParams" => defaults("layerEconomicFields"), "constraints" => defaults("constraintFields"), "objectives" => defaults("objectiveFields"))
    Dict{String,Any}("id" => id, "data" => Dict{String,Any}("label" => key, "componentKey" => key, "categoryKey" => schema["category"],
        "portConfig" => Dict(port["id"] => port for port in schema["ports"]),
        "business" => Dict{String,Any}("componentKey" => key, "commonTechParams" => tech,
            "commonEconomicParams" => defaults("commonEconomicFields"), "boundaryIds" => boundaries,
            "layerConfigs" => Dict("1" => deepcopy(settings), "2" => deepcopy(settings)))))
end
function flow_project()
    grid = flow_node("node-grid", "GRID")
    load = flow_node("node-load", "ELOAD"; boundaries=["flow-load"])
    bus = flow_node("node-bus1", "ELEC_BUS")
    bus["data"]["portConfig"] = Dict("bus-left-1" => Dict("medium" => "electric", "side" => "left", "offset" => 50),
        "bus-right-1" => Dict("medium" => "electric", "side" => "right", "offset" => 50))
    edge(id, source, source_handle, target, target_handle) = Dict("id" => id, "source" => source,
        "sourceHandle" => source_handle, "target" => target, "targetHandle" => target_handle, "data" => Dict("medium" => "electric"))
    Dict{String,Any}("id" => "flow-project", "name" => "仿真回归", "workspace" => Dict("activeCanvasId" => "A", "canvases" => [
        Dict("id" => "A", "name" => "A", "nodes" => [grid, bus, load], "edges" => [
            edge("supply", grid["id"], "power-out", bus["id"], "bus-left-1"),
            edge("export", bus["id"], "bus-right-1", grid["id"], "power-in"),
            edge("demand", bus["id"], "bus-right-1", load["id"], "power-in")])]),
        "boundaries" => [Dict("id" => "flow-load", "name" => "负荷", "meaning" => "load", "relatedComponents" => [load["id"]])],
        "algorithm" => Dict{String,Any}("solver" => "HiGHS", "slackEnabled" => false),
        "layerConfig" => Dict("layers" => [
            Dict("id" => "1", "name" => "计划层", "length" => "4h", "step" => "1h", "forward" => "4h"),
            Dict("id" => "2", "name" => "滚动层", "length" => "2h", "step" => "1h", "forward" => "1h")] ))
end

@testset "Single and rolling simulation complete with economic results" begin
    project = flow_project()
    boundary_path = joinpath(FLOW_DATA_ROOT, "projects", project["id"], "boundary.db")
    for layer in ("1", "2")
        set_ts(boundary_path, "flow-load|load|planned#$(layer)", TimeSeries(["$(hour):00" for hour in 0:47], fill(100.0, 48)))
    end
    save_boundary_config(boundary_path, "flow-load", "48h", "1h", 2, 48, "calendar", "2026-01-01", "2026-01-02")
    for mode in ("single_layer", "multi_layer")
        id = "flow-$(mode)"
        insert_task!(id=id, project_id=project["id"], canvas_id="A", layer_id="1", mode="offline", name=nothing,
            sim_start_time="0:00", sim_end_time="4:00", params_hash="flow-fixture", extra_json="{\"retiredModule\":{\"enabled\":true}}")
        task = get_task(id)
        task["sim_mode"] = mode
        task["target_layer_id"] = "1"
        mkpath(joinpath(TASKS_DATA_ROOT, id))
        write(joinpath(TASKS_DATA_ROOT, id, "project.json"), JSON3.write(project))
        ctx = get_or_create_context(id, "offline", "4:00", joinpath(TASKS_DATA_ROOT, id, "timeseries.db"))
        events = subscribe(ctx)
        execute_simulation_task(id, task)
        state = get_task(id)
        state["status"] == TASK_COMPLETED || @error "Simulation regression failed" message=state["error_message"]
        @test state["status"] == TASK_COMPLETED
        path = joinpath(TASKS_DATA_ROOT, id, "timeseries.db")
        rows, _ = snapshot_rows(path; skip_boundary=true)
        @test !isempty(rows)
        @test any(row -> row["sourceId"] == "GRID" && row["value"] > 0, rows)
        @test mode == "single_layer" || any(row -> row["layerId"] == "2", rows)
        economy = evaluate_task_economy(id, project; sim_start_time="0:00", sim_end_time="4:00", task_status=TASK_COMPLETED)
        @test !isempty(economy["layers"])
        @test !haskey(TASK_CONTEXTS, id)
        delivered = [take!(events) for _ in 1:Base.n_avail(events)]
        @test any(event -> event["type"] == "completed", delivered)
        @test all(event -> event["type"] in ("status", "data", "ts_rows", "completed"), delivered)
        tables = String.(_query(get_store(path).db, "SELECT name FROM sqlite_master WHERE type='table'")[1])
        @test !any(name -> endswith(name, "_period_results") || endswith(name, "_summary_results"), tables)
        close_store(path)
    end
end
