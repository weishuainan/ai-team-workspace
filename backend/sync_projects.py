#!/usr/bin/env python3
"""将本地 SQLite 中某位用户的项目和全部关联数据幂等恢复到线上。"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).parent / "ai_team.db"
DEFAULT_REMOTE_BASE = "http://localhost:8000"
PROJECT_TABLES = (
    "messages",
    "artifacts",
    "agent_tasks",
    "context_impacts",
    "event_logs",
    "project_files",
)
JSON_COLUMNS = {
    "projects": {"members", "member_names", "member_roles"},
    "messages": {"mentions"},
    "agent_tasks": {"input_snapshot"},
    "event_logs": {"details"},
}


def decode_row(table: str, row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    for column in JSON_COLUMNS.get(table, set()):
        value = result.get(column)
        if isinstance(value, str):
            result[column] = json.loads(value)
    return result


def load_snapshot(owner_mis: str, owner_name: str) -> dict[str, list[dict[str, Any]]]:
    if not DB_PATH.exists():
        raise RuntimeError(f"数据库文件不存在：{DB_PATH}")

    connection = sqlite3.connect(str(DB_PATH))
    connection.row_factory = sqlite3.Row
    try:
        clauses: list[str] = []
        params: list[str] = []
        if owner_mis:
            clauses.append("lower(owner_mis) = lower(?)")
            params.append(owner_mis)
        if owner_name:
            clauses.append("(coalesce(owner_mis, '') = '' and owner_name = ?)")
            params.append(owner_name)
        where = f"WHERE {' OR '.join(clauses)}" if clauses else ""
        project_rows = connection.execute(
            f"SELECT * FROM projects {where} ORDER BY created_at", params
        ).fetchall()
        projects = [decode_row("projects", row) for row in project_rows]
        project_ids = [project["id"] for project in projects]
        snapshot: dict[str, list[dict[str, Any]]] = {"projects": projects}
        if not project_ids:
            return snapshot

        placeholders = ",".join("?" for _ in project_ids)
        for table in PROJECT_TABLES:
            rows = connection.execute(
                f"SELECT * FROM {table} WHERE project_id IN ({placeholders})", project_ids
            ).fetchall()
            snapshot[table] = [decode_row(table, row) for row in rows]
        return snapshot
    finally:
        connection.close()


def sync_snapshot(snapshot: dict[str, list[dict[str, Any]]], remote_base: str, sync_key: str) -> dict[str, Any]:
    if not sync_key:
        raise RuntimeError("请先设置 SYNC_API_KEY，再执行线上恢复")
    request = urllib.request.Request(
        f"{remote_base.rstrip('/')}/api/v1/admin/sync-project-snapshot",
        data=json.dumps(snapshot, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Sync-Key": sync_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"线上同步失败（HTTP {error.code}）：{detail}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-username", default=os.environ.get("SYNC_OWNER_USERNAME", ""))
    parser.add_argument("--owner-name", default=os.environ.get("SYNC_OWNER_NAME", ""))
    parser.add_argument("--remote-base", default=os.environ.get("REMOTE_BASE", DEFAULT_REMOTE_BASE))
    parser.add_argument("--dry-run", action="store_true", help="只检查本地数据，不调用线上接口")
    args = parser.parse_args()
    if not args.owner_username.strip() and not args.owner_name.strip():
        parser.error("必须通过参数或环境变量指定用户名或姓名")

    try:
        snapshot = load_snapshot(args.owner_username.strip(), args.owner_name.strip())
        projects = snapshot.get("projects", [])
        if not projects:
            print("没有找到该用户的本地项目")
            return 0

        print(f"找到 {len(projects)} 个项目：")
        for project in projects:
            print(f"  - {project['name']}（{project['current_stage']}，{project['id']}）")
        print("关联数据：" + "，".join(f"{table}={len(rows)}" for table, rows in snapshot.items() if table != "projects"))
        if args.dry_run:
            return 0

        result = sync_snapshot(snapshot, args.remote_base, os.environ.get("SYNC_API_KEY", ""))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
