---
name: underwater-simulation
description: 当用户需要规划、启动或检查水下信道、通信和链路仿真时使用，指导资源查询、模板执行和结果解释。
---

# 水下通信仿真演示

## 使用步骤

1. 确认用户的距离、频率、带宽和仿真规模；未指定时说明采用 small 演示规模及模板默认参数。
2. 用 `mcp__demo__simulation_templates` 查看模板，用 `mcp__demo__cluster_resources` 查看资源；工具是否可用，以当前模型收到的工具列表为准。
3. 优先调用 `mcp__demo__run_simulation`，由后台模板完成规划、资源检查、动态申请和提交。只运行部分链路时使用 `simulate_channel` 或 `simulate_communication`。
4. 不绕过节点依赖、并行资源上限或串行锁。不要把模板流程改成模型自行安排的无约束调用。
5. 拿到 jobId 后，用 `mcp__demo__simulation_status` 持续查询，waitMs 可取 1000，直到任务进入 completed、failed 或 cancelled。
6. 回答中先说明任务状态，再解释报告中的调制方式、误码率、分组投递率和有效吞吐；把工具的原始返回与自己的解释区分开。
7. 明确说明资源来自本机演示配额账本，数值计算是简化模型。零观测误码不代表真实误码率为零，不把演示结果解释为工程认证结论。

## 取消和异常

- 用户要求取消时，使用 `mcp__demo__cancel_simulation`，并检查资源已经释放。
- 停止生成不会自动取消后台仿真任务。
- 工具未启用、资源不足或调用失败时，说明实际原因；不编造运行状态或结果。
