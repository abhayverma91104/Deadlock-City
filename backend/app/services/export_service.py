from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, Literal


class ExportService:
    """Formats simulation analytics and state snapshots for JSON or CSV export."""

    @staticmethod
    def build_analytics_summary(session_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
        processes = state.get("processes") or []
        resources = state.get("resources") or []
        deadlock_report = state.get("deadlock_report") or {}

        total_procs = len(processes)
        active_procs = sum(1 for p in processes if p.get("state") != "TERMINATED")
        waiting_procs = sum(1 for p in processes if p.get("state") == "WAITING")
        blocked_procs = sum(1 for p in processes if p.get("state") == "BLOCKED")
        terminated_procs = sum(1 for p in processes if p.get("state") == "TERMINATED")
        completed_procs = int(
            state.get(
                "completed_count",
                sum(1 for p in processes if p.get("state") == "TERMINATED" and p.get("remaining_time", 1) == 0),
            )
        )
        deadlocked_procs = len(deadlock_report.get("deadlocked_processes") or [])

        pending_request_units = 0
        pending_request_processes = 0
        for p in processes:
            if p.get("state") == "TERMINATED":
                continue
            reqs = p.get("pending_request") or {}
            qty = sum(int(v) for v in reqs.values() if int(v) > 0)
            if qty > 0:
                pending_request_units += qty
                pending_request_processes += 1

        total_res_types = len(resources)
        total_instances = sum(r.get("total_instances", 0) for r in resources)
        available_instances = sum(r.get("available_instances", 0) for r in resources)
        allocated_instances = sum(r.get("allocated_instances", 0) for r in resources)
        utilization_pct = round((allocated_instances / total_instances) * 100.0, 2) if total_instances > 0 else 0.0

        waiting_ticks = [p.get("waiting_ticks", 0) for p in processes]
        avg_wait = round(sum(waiting_ticks) / len(waiting_ticks), 2) if waiting_ticks else 0.0

        metrics_history = state.get("metrics_history") or []
        events_list = state.get("events") or []
        total_metric_samples_recorded = int(state.get("total_metric_samples_recorded", len(metrics_history)))
        total_events_recorded = int(state.get("total_events_recorded", len(events_list)))
        retained_metric_samples = len(metrics_history)
        retained_events = len(events_list)
        discarded_metric_samples = max(0, total_metric_samples_recorded - retained_metric_samples)
        discarded_events = max(0, total_events_recorded - retained_events)
        retained_tick_range = (
            [metrics_history[0].get("tick", 0), metrics_history[-1].get("tick", 0)]
            if metrics_history
            else [0, 0]
        )

        return {
            "session_id": session_id,
            "tick": state.get("tick", 0),
            "preset": state.get("preset"),
            "seed": state.get("seed"),
            "safety_status": state.get("safety_status"),
            "telemetry_retention": {
                "metrics_window_cap": 240,
                "events_window_cap": 200,
                "total_metric_samples_recorded": total_metric_samples_recorded,
                "retained_metric_samples": retained_metric_samples,
                "discarded_metric_samples": discarded_metric_samples,
                "retained_tick_range": retained_tick_range,
                "total_events_recorded": total_events_recorded,
                "retained_events": retained_events,
                "discarded_events": discarded_events,
            },
            "kpis": {
                "total_processes": total_procs,
                "active_processes": active_procs,
                "completed_processes": completed_procs,
                "waiting_processes": waiting_procs,
                "blocked_processes": blocked_procs,
                "terminated_processes": terminated_procs,
                "deadlocked_processes": deadlocked_procs,
                "total_resource_types": total_res_types,
                "total_resource_instances": total_instances,
                "available_resource_instances": available_instances,
                "allocated_instances": allocated_instances,
                "resource_utilization_pct": utilization_pct,
                "pending_request_units": pending_request_units,
                "pending_request_processes": pending_request_processes,
                "granted_request_count": int(state.get("granted_request_count", 0)),
                "rejected_request_count": int(state.get("rejected_request_count", 0)),
                "deadlock_count": state.get("deadlock_count", 0),
                "recovery_count": state.get("recovery_count", 0),
                "recovery_terminated_count": int(state.get("recovery_terminated_count", 0)),
                "preemption_count": state.get("preemption_count", 0),
                "avg_waiting_ticks": avg_wait,
            },
            "metrics_history": state.get("metrics_history") or [],
            "events": state.get("events") or [],
            "process_state_distribution": _process_distribution(processes),
        }

    @staticmethod
    def to_json_bytes(session_id: str, state: Dict[str, Any]) -> bytes:
        payload = {
            "analytics": ExportService.build_analytics_summary(session_id, state),
            "state": state,
        }
        return json.dumps(payload, indent=2).encode("utf-8")

    @staticmethod
    def to_csv_bytes(
        session_id: str,
        state: Dict[str, Any],
        scope: Literal["metrics", "events"] = "metrics",
    ) -> bytes:
        buf = io.StringIO()
        writer = csv.writer(buf)
        if scope == "events":
            total_events_recorded = int(state.get("total_events_recorded", len(state.get("events") or [])))
            writer.writerow([
                "session_id",
                "preset",
                "seed",
                "event_id",
                "tick",
                "recorded_at_utc",
                "category",
                "severity",
                "process_id",
                "resource_id",
                "message",
                "metadata_json",
                "total_events_recorded",
            ])
            for ev in state.get("events") or []:
                meta = ev.get("metadata") or {}
                writer.writerow([
                    session_id,
                    state.get("preset") or "custom",
                    state.get("seed", 42),
                    ev.get("id", ""),
                    ev.get("tick", 0),
                    ev.get("recorded_at", ""),
                    ev.get("type", "INFO"),
                    ev.get("severity", "info"),
                    meta.get("process_id", ""),
                    meta.get("resource_id", ""),
                    ev.get("message", ""),
                    json.dumps(meta),
                    total_events_recorded,
                ])
            return buf.getvalue().encode("utf-8")

        total_samples_recorded = int(state.get("total_metric_samples_recorded", len(state.get("metrics_history") or [])))
        writer.writerow([
            "session_id",
            "tick",
            "utilization_pct",
            "active_count",
            "blocked_count",
            "deadlocked_count",
            "allocation_count",
            "available_count_units",
            "waiting_count_procs",
            "completed_count_procs",
            "terminated_count_procs",
            "pending_request_units",
            "deadlock_count_total",
            "recovery_count_total",
            "safety_status",
            "preset",
            "seed",
            "recorded_at_utc",
            "total_metric_samples_recorded",
        ])
        for pt in state.get("metrics_history") or []:
            writer.writerow([
                session_id,
                pt.get("tick", 0),
                pt.get("utilization_pct", 0.0),
                pt.get("active_count", 0),
                pt.get("blocked_count", 0),
                pt.get("deadlocked_count", 0),
                pt.get("allocation_count", 0),
                pt.get("available_count", 0),
                pt.get("waiting_count", 0),
                pt.get("completed_count", 0),
                pt.get("terminated_count", 0),
                pt.get("pending_request_units", 0),
                pt.get("deadlock_count", 0),
                pt.get("recovery_count", 0),
                pt.get("safety_status", state.get("safety_status", "SAFE")),
                state.get("preset") or "custom",
                state.get("seed", 42),
                pt.get("recorded_at", ""),
                total_samples_recorded,
            ])
        return buf.getvalue().encode("utf-8")

    @staticmethod
    def experiment_to_json_bytes(kind: str, title: str, data: Dict[str, Any]) -> bytes:
        return json.dumps({"kind": kind, "title": title, "data": data}, indent=2).encode("utf-8")

    @staticmethod
    def experiment_to_csv_bytes(kind: str, title: str, data: Dict[str, Any]) -> bytes:
        buf = io.StringIO()
        writer = csv.writer(buf)
        if kind == "scheduling":
            writer.writerow([
                "experiment_title",
                "algorithm",
                "quantum_ticks",
                "avg_waiting_time_ticks",
                "avg_turnaround_time_ticks",
                "avg_response_time_ticks",
                "context_switches",
                "cpu_utilization_pct",
                "total_time_ticks",
            ])
            for item in data.get("comparisons") or []:
                writer.writerow([
                    title,
                    item.get("algorithm", ""),
                    item.get("quantum", 0),
                    item.get("avg_waiting_time", 0.0),
                    item.get("avg_turnaround_time", 0.0),
                    item.get("avg_response_time", 0.0),
                    item.get("context_switches", 0),
                    item.get("cpu_utilization_pct", 0.0),
                    item.get("total_time", 0),
                ])
        elif kind == "synchronization":
            writer.writerow([
                "experiment_title",
                "scenario",
                "mode",
                "completed_cleanly",
                "race_or_deadlock_detected",
                "produced_count",
                "consumed_count",
                "overflows",
                "underflows",
                "conflicts",
                "completed_meals",
                "event_seq",
                "thread_id",
                "thread_state",
                "action",
                "resource",
                "detail",
            ])
            events = data.get("events") or [{}]
            for ev in events:
                writer.writerow([
                    title,
                    data.get("scenario", ""),
                    data.get("mode", ""),
                    data.get("completed_cleanly", False),
                    data.get("race_or_deadlock_detected", False),
                    data.get("produced_count", 0),
                    data.get("consumed_count", 0),
                    data.get("overflows", 0),
                    data.get("underflows", 0),
                    data.get("conflicts", 0),
                    data.get("completed_meals", 0),
                    ev.get("seq", ""),
                    ev.get("thread_id", ""),
                    ev.get("state", ""),
                    ev.get("action", ""),
                    ev.get("resource", ""),
                    ev.get("detail", ""),
                ])
        else:
            # Generic comparison rows
            writer.writerow([
                "experiment_title",
                "mode",
                "preset",
                "seed",
                "arm_label",
                "final_safety_status",
                "final_tick",
                "utilization_pct",
                "deadlock_count",
                "recovery_count",
                "terminated_or_rejected",
                "detail",
            ])
            for arm in data.get("arms") or []:
                writer.writerow([
                    title,
                    data.get("mode", ""),
                    data.get("preset", ""),
                    data.get("seed", 42),
                    arm.get("label", ""),
                    arm.get("safety_status", ""),
                    arm.get("tick", 0),
                    arm.get("utilization_pct", 0.0),
                    arm.get("deadlock_count", 0),
                    arm.get("recovery_count", 0),
                    arm.get("primary_metric", ""),
                    arm.get("summary", ""),
                ])
        return buf.getvalue().encode("utf-8")


def _process_distribution(processes: list[Dict[str, Any]]) -> Dict[str, int]:
    dist = {"NEW": 0, "READY": 0, "RUNNING": 0, "WAITING": 0, "BLOCKED": 0, "TERMINATED": 0}
    for p in processes:
        st = p.get("state", "READY")
        dist[st] = dist.get(st, 0) + 1
    return dist
