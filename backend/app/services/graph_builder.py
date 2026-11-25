from __future__ import annotations

from typing import Any, Dict, List, Set


def build_rag_graph(state: Dict[str, Any]) -> Dict[str, Any]:
    """Derives Resource Allocation Graph nodes and edges from canonical C++ SimulationState."""
    deadlock_report = state.get("deadlock_report") or {}
    deadlocked_procs: Set[str] = set(deadlock_report.get("deadlocked_processes") or [])
    involved_res: Set[str] = set(deadlock_report.get("involved_resources") or [])
    cycles: List[List[str]] = deadlock_report.get("cycles") or []

    cycle_nodes: Set[str] = set()
    cycle_edge_pairs: Set[tuple[str, str]] = set()
    for cyc in cycles:
        for i, node_id in enumerate(cyc):
            cycle_nodes.add(node_id)
            nxt = cyc[(i + 1) % len(cyc)]
            cycle_edge_pairs.add((node_id, nxt))

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    processes = state.get("processes") or []
    resources = state.get("resources") or []

    for idx, p in enumerate(processes):
        pid = p["id"]
        is_deadlocked = pid in deadlocked_procs
        nodes.append({
            "id": pid,
            "type": "process",
            "position": {"x": 120, "y": idx * 140},
            "data": {
                "id": pid,
                "name": p["name"],
                "state": p["state"],
                "priority": p["priority"],
                "allocated": p.get("allocated", {}),
                "pending_request": p.get("pending_request", {}),
                "need": p.get("need", {}),
                "is_deadlocked": is_deadlocked,
                "in_cycle": pid in cycle_nodes,
            },
        })

    for idx, r in enumerate(resources):
        rid = r["id"]
        nodes.append({
            "id": rid,
            "type": "resource",
            "position": {"x": 520, "y": idx * 150},
            "data": {
                "id": rid,
                "name": r["name"],
                "category": r["category"],
                "total_instances": r["total_instances"],
                "available_instances": r["available_instances"],
                "allocated_instances": r["allocated_instances"],
                "status": r["status"],
                "is_involved_in_deadlock": rid in involved_res,
                "in_cycle": rid in cycle_nodes,
            },
        })

    for p in processes:
        if p.get("state") == "TERMINATED":
            continue
        pid = p["id"]
        for rid, qty in (p.get("allocated") or {}).items():
            if qty > 0:
                in_cycle = (rid, pid) in cycle_edge_pairs
                is_deadlock_edge = pid in deadlocked_procs and rid in involved_res
                edges.append({
                    "id": f"alloc_{rid}_{pid}",
                    "source": rid,
                    "target": pid,
                    "kind": "allocation",
                    "units": qty,
                    "in_cycle": in_cycle,
                    "is_deadlocked": is_deadlock_edge,
                    "label": f"alloc ×{qty}",
                })

        for rid, qty in (p.get("pending_request") or {}).items():
            if qty > 0:
                in_cycle = (pid, rid) in cycle_edge_pairs
                is_deadlock_edge = pid in deadlocked_procs and rid in involved_res
                edges.append({
                    "id": f"req_{pid}_{rid}",
                    "source": pid,
                    "target": rid,
                    "kind": "request",
                    "units": qty,
                    "in_cycle": in_cycle,
                    "is_deadlocked": is_deadlock_edge,
                    "label": f"req ×{qty}",
                })

    return {
        "nodes": nodes,
        "edges": edges,
        "has_cycle": bool(deadlock_report.get("has_cycle_in_rag")),
        "deadlock_detected": bool(deadlock_report.get("detected")),
        "deadlocked_processes": list(deadlocked_procs),
        "cycles": cycles,
        "wait_for_edges": deadlock_report.get("wait_for_edges") or [],
    }
