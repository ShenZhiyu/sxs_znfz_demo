/** 从项目内受信模板生成的节点脚本；占位符由 JSON 编码后替换，不使用 shell 拼接。 */
// 任务类型由已经校验的 DAG 节点决定，不接受模型传任意可执行代码。
process.argv[2] = {{TASK_JSON}};
// 输入从父调度器 stdin 传入，结果与进度沿 stdout JSON Lines 返回。
await import({{WORKER_URL_JSON}});
