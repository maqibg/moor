---
"moor-sidecar": patch
---

HTTP header `{env:VAR}` 占位符现在优先读取单个 server 的环境变量，缺失时继续回退到 Moor 进程环境变量。
