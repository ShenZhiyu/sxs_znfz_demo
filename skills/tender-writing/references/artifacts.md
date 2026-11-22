# 工作文件与 Word 组装约定

## 可恢复的工作目录

```text
work/tenders/<项目简称>/
  input/                 已提供材料的工作副本；需要修改上传文件时复制到此处
  outline.md             样例标题/层级/出处、条款映射、最终顺序与撰写顺序
  consistency.md         总体与分系统共用的术语、接口、能力和验证口径
  progress.json          阶段、逐章版本/状态、定稿记录、遗留项、下一章
  chapters/              按最终编号保存的逐章 Markdown 正文
  figures.json           图位、完整提示词、位置、来源章节版本、图片审核记录
  images/                真实生成并核对的图片
  template.docx          用户模板的工作副本（如有）
  document.json          定稿内容的机器可读组装清单
  output/                各次输出，文件名带实际时间戳
```

按实际进度创建文件。`progress.json` 可采用：

```json
{
  "project": "项目简称",
  "stage": "writing-overall",
  "text_finalized": false,
  "writing_order": ["1", "2.1", "2.2", "3"],
  "chapters": [{"id": "1", "revision": 1, "status": "draft", "file": "chapters/01-overall.md", "open_items": []}],
  "next_chapter": "2.1"
}
```

根据实际情况使用 `outline`、`writing-overall`、`writing-subsystems`、`reviewing-text`、`generating-figures`、`assembling`、`delivered` 等阶段。状态是事实记录，不是预先承诺。

关键资料缺失时，阶段使用 `waiting_for_input`，记录 `missing_inputs`（资料名、用途、补充方式）、`resume_stage` 和 `next_chapter`。提示用户补充输入或上传，收到后先检查补充内容再恢复对应阶段。非关键待确认项保留在章节的 `open_items`，不阻断其他已有资料支持的章节。

网页通过输入框旁“＋ 文件”或拖放上传，选择后需要发送消息，附件才进入 Agent 会话。原始附件存储在 `work/uploads/<上传ID>/<文件名>`，由官方 file 引用提供真实读取路径。文件名相同的再次上传保存为不同副本。待编辑模板应从上传原件复制到项目目录，不覆盖原件。用户也可通过右侧“文件”面板将以前上传的文件重新添加为附件。

交付时确认 `output/` 中的文件存在，给出下载入口。例如文件位于 `work/tenders/demo/output/report.docx`，链接为 `[下载 Word](/api/files/download?path=tenders%2Fdemo%2Foutput%2Freport.docx)`。中文与空格使用 URL 编码；工作根目录由 `DSH_DEMO_WORK_DIR` 改变时，下载路径仍相对该根目录。文件面板也会自动发现工作根目录内的产物。

## 脚本环境

脚本使用 Python 3.10+ 和 `python-docx`，与 Node 插件运行时分开；`npm install` 不会安装它。使用已有 Python 环境或在本项目目录创建独立环境：

```bash
python3 -m venv .dsh/tender-venv
.dsh/tender-venv/bin/python -m pip install -r skills/tender-writing/scripts/requirements.txt
```

有 `uv` 时可用 `uv venv .dsh/tender-venv` 和 `uv pip install --python .dsh/tender-venv/bin/python -r skills/tender-writing/scripts/requirements.txt`。环境缺少工具时说明真实缺项，不改动全局 Python 环境。以下命令均在 `dsh-demo` 根目录执行；技能被移动时以实际技能目录为准。

## 读取 DOCX 样例

```bash
.dsh/tender-venv/bin/python skills/tender-writing/scripts/assemble_docx.py inspect 样例.docx --output work/tenders/项目简称/sample-inspection.json
```

提取段落文字、样式、标题层级提示、表格、页面尺寸和页眉页脚，供 Agent 判断大纲。Word 文本框、图中文字、复杂编号、批注、嵌入对象等不在完整提取范围；PDF 或扫描件需使用其他实际可用工具。不要将检查输出中的段落顺序误当成确认过的大纲。

## 准备版式模板

1. 复制用户的 DOCX 模板到工作目录，不覆盖原文件。
2. 在副本中清除样例正文，保留所需封面、样式、页眉页脚及分节设置。在需要插入新正文的位置留一个**单独段落**，内容为 `{{CONTENT}}`。脚本要求全文正文顶层恰好有一个该段落，避免重复插入；不支持把正文标记放在表格、页眉或文本框里。
3. 可见文档标题使用单独段落 `{{DOCUMENT_TITLE}}`；可选输出时间段落用 `{{OUTPUT_TIMESTAMP}}`。两者必须位于正文顶层。没有标题标记时，脚本会在正文插入位置补上带时间戳的标题。标记必须独占整个段落（允许分成多个 Word run）。
4. 保留样例中的多个分节时，人工确定正文应落在哪一节。脚本不自动重建封面、目录、跨节排版或自动章节编号。已有标题应避免同时手写编号和使用 Word 自动编号。

没有 DOCX 版式模板时，可不传模板，生成基本 A4 版式用于内容预览；须明确说明这只是通用版式，不能声称复现样例。脚本不会删除未标记的旧正文，也不会无声接受缺少正文标记的模板。

## 输出字体与待确认高亮

不论是否提供模板，输出 Word 的可编辑文字统一为**宋体、黑色（`000000`）**，覆盖标题、正文、列表、表格、图题、页眉页脚以及模板保留的文字。脚本同时覆盖样式和直接格式中的字体与颜色，清除对应主题覆盖；模板的字号、加粗、段落设置与页面布局继续保留。模板原件不改动，因字体变化导致的换行与分页需在输出后检查。

待确认内容写成 `【待确认：具体内容或问题】`，例如 `链路带宽为【待确认：请提供带宽及单位】，其余接口保持一致。`。草稿中完整标记呈**黄色文本高亮**，前后已经确定的文字不因该标记而新增高亮；标记跨多个 Word run、位于表格或页眉页脚时同样处理。脚本也兼容 `[待确认：……]`，新内容统一使用中文方括号。高亮不改变文字的宋体和黑色。

待确认项只有在用户确认并更新源文及 `document.json` 后才移除标记；不可只清除底色而保留未确认事实。最终版拒绝任何待确认标记，包括模板保留文字中的标记。图片内部的文字不属于 Word 可编辑文字，须在绘图提示词和图片检查阶段落实宋体、黑色；本脚本不改写图片像素。

## `document.json` 清单

段落内容是**纯文本**，不会自动解析 Markdown。把源文标题映射为 `heading`，列表映射为 `bullet` / `number`，表格映射为 `table`；不要把整章 Markdown 当作一个段落。正式清单应包含完整原文，不能用“内容同上”等缩略语。

```json
{
  "title": "项目技术投标文件",
  "timezone": "Asia/Shanghai",
  "text_finalized": false,
  "styles": {"body": "Normal", "title": "Title", "caption": "Caption", "bullet": "List Bullet", "number": "List Number", "table": "Table Grid"},
  "sections": [
    {
      "id": "1",
      "title": "1 总体方案",
      "level": 1,
      "blocks": [
        {"type": "paragraph", "text": "这里写入当前章节的完整正文。"},
        {"type": "heading", "text": "1.1 总体架构", "level": 2},
        {"type": "bullet", "text": "总体能力说明。"},
        {"type": "figure", "id": "FIG-001"},
        {"type": "table", "headers": ["接口", "方向"], "rows": [["任务接口", "总体到分系统"]]}
      ]
    },
    {"id": "2", "title": "2 分系统方案", "level": 1, "blocks": [{"type": "paragraph", "text": "这里写入分系统章节的完整正文。"}]}
  ],
  "figures": [
    {
      "id": "FIG-001",
      "caption": "总体架构示意图",
      "prompt": "白底技术架构图；节点、箭头、布局等采用图清单中的完整提示词。",
      "status": "placeholder",
      "image": null,
      "width_cm": 15
    }
  ]
}
```

- `sections` 数组严格按最终文档顺序排列，顺序与写作顺序可以不同。每项含唯一 `id`、`title`、1–9 的 `level` 和非空 `blocks`。
- `paragraph`、`bullet`、`number` 使用 `text`；`heading` 还需要 `level`；`page_break` 不需要额外内容。可为文本块单独指定 `style`，为 section 指定 `style` 来映射中文/自定义标题样式。
- `styles` 可省略；使用模板时优先将它映射到真实样式名。默认标题样式是 `Heading 1`…`Heading 9`。样式不存在会报错，不悄悄丢失格式。
- 表格每行列数必须等于表头列数。脚本不处理合并单元格、重复表头或复杂公式；有这些需求时采用其他文档编辑方式，保留同样的定稿与时间戳约定。
- 图清单可从 `figures.json` 合并到 `figures`。有文字定稿记录后才将 `text_finalized` 设置为 `true`。每张图必须被正文引用；脚本拒绝未使用的图清单项和不存在的图 ID。
- `image` 路径相对清单文件所在目录，可使用绝对路径；图为真实且核对通过的 PNG/JPEG 后设置 `status: "approved"`。草稿可保留 `placeholder`、`generated`、`needs_revision` 状态。正式版只插入 `approved` 图；草稿对未审核的图仍输出图位及提示词。
- 图题按首次出现顺序自动生成“图 1 …”，相同 ID 多次引用沿用编号；固定图 ID 不等于最终图号。跨章节的手写图号要在组装前按此清单核对。
- `width_cm` 默认 15，插图时限制在当前分节可用页面宽度内，并保持原图比例。需要其他尺寸和布局时可调整脚本或用文档工具。
- 脚本只做基础终稿校验：`text_finalized`、图片状态、图片文件存在性和 `【待确认` / `{{FIG:` 等遗留标记；不会判断标书事实是否成立或正文是否满足招标要求。

## 输出命令

先输出含图位的文字草稿：

```bash
.dsh/tender-venv/bin/python skills/tender-writing/scripts/assemble_docx.py build work/tenders/项目简称/document.json --draft --template work/tenders/项目简称/template.docx
```

全部文字与图片就绪后，去掉 `--draft` 输出最终版：

```bash
.dsh/tender-venv/bin/python skills/tender-writing/scripts/assemble_docx.py build work/tenders/项目简称/document.json --template work/tenders/项目简称/template.docx
```

没有版式模板时省略 `--template`。默认输出到清单同级的 `output/`，可用 `--output-dir` 指定。命令行路径相对当前工作目录，清单中的图片路径相对清单目录。命令返回 JSON，包含文件绝对路径、实际输出时间、标题、章节数、插图数、字体、字体颜色、高亮颜色及待确认项数；失败时返回非零退出码，不声称已交付。

文件名示意：`项目技术投标文件_20261020_153012_123456+0800_草稿.docx`。时间必须取执行时的实际时间，不使用这个示意值。标题、核心属性标题、文件名使用同一次生成的时间戳；文件以独占方式创建，防止覆盖已有输出。

修改组装脚本后，可运行 `.dsh/tender-venv/bin/python skills/tender-writing/scripts/test_assemble_docx.py`。回归检查在临时目录生成 Word 并读取实际 XML，验证字体、颜色、精确高亮、模板格式保留及终稿拦截，不改动用户文件；它不能替代逐页渲染检查。
