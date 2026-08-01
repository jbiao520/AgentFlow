# Schedules — Design

Date: 2026-08-01  
Status: implementing (option A: once | interval)  
Scope: 侧栏导航整理 + 定时执行模版

## Nav

- 全局总览 → **Dashboard**
- Agent 矩阵 → **Agents**
- 移除侧栏「Agent 详情配置」；矩阵点击进详情；详情页加返回 Agents
- 新增侧栏 **Schedules**（定时任务）

## Schedule model (A)

| mode | 含义 |
|------|------|
| `once` | 指定 `run_at` 执行一次，触发后 `enabled=0` |
| `interval` | 从 `next_run_at` 起每隔 `interval_secs` 重复 |

变量值存 `values_json`；到期后走与模版库相同的 `instantiate → dispatch → start`。

## Data

```text
schedules
  id, name, template_id, values_json
  mode ('once'|'interval'), interval_secs?, enabled
  next_run_at, last_run_at, last_run_id, last_error, run_count
  created_at, updated_at
```

后台 ticker（约 15s）扫描 `enabled=1 AND next_run_at <= now`。
