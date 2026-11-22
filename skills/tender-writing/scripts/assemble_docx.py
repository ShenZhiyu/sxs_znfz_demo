#!/usr/bin/env python3
"""读取 DOCX 样例，或将章节清单和图片插入 DOCX 模板；不调用模型。"""

import argparse
import json
import math
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    from docx.oxml import OxmlElement, parse_xml
    from docx.oxml.ns import qn
    from docx.opc.oxml import serialize_part_xml
    from docx.shared import Cm, Pt
except ImportError:
    sys.exit("缺少 python-docx；请在独立 Python 环境中安装本目录 requirements.txt。")


# 完整标记精确高亮；忘记写右括号时，保守地高亮到本段末尾，避免漏掉待确认项。
PENDING_TEXT = re.compile(r"【待确认[^】]*(?:】|$)|\[待确认[^\]]*(?:\]|$)")


def child_or_create(parent, name):
    """查找直接子节点；不要用元素的布尔值判断，以免把空节点误判成不存在。"""
    child = parent.find(qn(name))
    if child is None:
        # python-docx 已知节点用其方法插入，保持 OOXML 要求的属性顺序。
        factory = getattr(parent, f"get_or_add_{name.split(':')[1]}", None)
        if factory is not None:
            child = factory()
        else:
            child = OxmlElement(name)
            parent.append(child)
    return child


def set_text_format(properties):
    """覆盖字体与字体颜色，保留字号、加粗、缩进等其他版式属性。"""
    fonts = child_or_create(properties, "w:rFonts")
    # Word 为中文、西文和复杂文字分别选择字体；主题字体也必须清除，否则可能覆盖指定值。
    for attribute in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
        fonts.attrib.pop(qn(f"w:{attribute}"), None)
    for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{attribute}"), "宋体")
    color = child_or_create(properties, "w:color")
    for attribute in ("themeColor", "themeTint", "themeShade"):
        color.attrib.pop(qn(f"w:{attribute}"), None)
    color.set(qn("w:val"), "000000")


def highlight_pending(paragraph):
    """按段落匹配跨 run 的待确认标记，只给命中部分加黄色底色。"""
    # 超链接、文本框可能包裹 run；只选属于当前段落的文字，避免嵌套文本框重复处理。
    text_nodes = [node for node in paragraph.iter(qn("w:t"))
                  if next(node.iterancestors(qn("w:p")), None) is paragraph]
    text = "".join(node.text or "" for node in text_nodes)
    spans = [match.span() for match in PENDING_TEXT.finditer(text)]
    if not spans:
        return 0
    offsets, position = {}, 0
    for node in text_nodes:
        offsets[node] = position
        position += len(node.text or "")
    runs = list(dict.fromkeys(node.getparent() for node in text_nodes))
    for run in runs:
        if run.tag != qn("w:r"):
            continue
        properties = run.find(qn("w:rPr"))
        pieces = []

        def append_piece(element, highlighted):
            # 拆分 run 而不是重写 paragraph.text，才能保留超链接、书签、字段、图片及原有格式。
            if not pieces or pieces[-1][1] != highlighted:
                fragment = OxmlElement("w:r", attrs=dict(run.attrib))
                if properties is not None:
                    fragment.append(deepcopy(properties))
                if highlighted:
                    rpr = child_or_create(fragment, "w:rPr")
                    child_or_create(rpr, "w:highlight").set(qn("w:val"), "yellow")
                pieces.append((fragment, highlighted))
            pieces[-1][0].append(element)

        changed = False
        for child in run:
            if child.tag == qn("w:rPr"):
                continue
            if child not in offsets or not child.text:
                append_piece(deepcopy(child), pieces[-1][1] if pieces else False)
                continue
            start, end = offsets[child], offsets[child] + len(child.text)
            boundaries = sorted({start, end} | {max(start, min(end, point))
                                                for span in spans for point in span})
            for left, right in zip(boundaries, boundaries[1:]):
                highlighted = any(a <= left < b for a, b in spans)
                changed |= highlighted
                fragment = deepcopy(child)
                fragment.text = child.text[left - start:right - start]
                # 拆分后新产生的首尾空格也需要保留。
                fragment.set(qn("xml:space"), "preserve")
                append_piece(fragment, highlighted)
        if changed:
            for fragment, _ in pieces:
                run.addprevious(fragment)
            run.getparent().remove(run)
    return len(spans)


def format_document(document, draft):
    """统一输出包内的 Word 文字，含样式、编号、表格、页眉页脚和模板保留文字。"""
    pending_count = 0
    for part in document.part.package.parts:
        if not str(part.partname).startswith("/word/") or not str(part.partname).endswith(".xml"):
            continue
        # 页眉、样式等使用 XmlPart；脚注、批注等也可能以普通 Part 加载，需读写其 XML。
        root = part.element if hasattr(part, "element") else parse_xml(part.blob)
        for paragraph in root.iter(qn("w:p")):
            pending_count += highlight_pending(paragraph)
        # 直接格式优先级高于样式；二者都设置，避免模板中的显式颜色或主题字体漏网。
        for run in root.iter(qn("w:r")):
            if run.find(qn("w:rPr")) is None:
                run.insert(0, OxmlElement("w:rPr"))
        if root.tag == qn("w:styles"):
            defaults = root.find(qn("w:docDefaults"))
            if defaults is None:
                defaults = OxmlElement("w:docDefaults")
                root.insert(0, defaults)
            child_or_create(child_or_create(defaults, "w:rPrDefault"), "w:rPr")
            for style in root.iter(qn("w:style")):
                child_or_create(style, "w:rPr")
        for numbering_level in root.iter(qn("w:lvl")):
            # 默认圆点原来依赖 Symbol 私用字符；改用标准 Unicode 圆点，才能随宋体显示。
            number_format = numbering_level.find(qn("w:numFmt"))
            label = numbering_level.find(qn("w:lvlText"))
            if (number_format is not None and number_format.get(qn("w:val")) == "bullet"
                    and label is not None and label.get(qn("w:val")) == "\uf0b7"):
                label.set(qn("w:val"), "•")
            child_or_create(numbering_level, "w:rPr")
        for properties in root.iter(qn("w:rPr")):
            set_text_format(properties)
        # 普通 Part 没有可变的 element 属性，序列化后才会写入最终 DOCX。
        if not hasattr(part, "element"):
            part._blob = serialize_part_xml(root)
    require(draft or pending_count == 0, "最终版仍有待确认标记（含模板、表格或页眉页脚）；请确认后移除或使用 --draft")
    return pending_count


def require(condition, message):
    """将输入问题转成可读错误，不静默忽略无法组装的内容。"""
    if not condition:
        raise ValueError(message)


def string(value, label):
    require(isinstance(value, str) and value.strip(), f"{label} 必须是非空文本")
    return value


def level(value):
    require(type(value) is int and 1 <= value <= 9, "标题 level 必须是 1–9 的整数")
    return value


def paragraphs_in_order(document):
    """只读正文顶层段落和表格，保留它们的相对顺序。"""
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    result = []
    for element in document.element.body:
        if element.tag == qn("w:p"):
            paragraph = Paragraph(element, document)
            outline = paragraph._p.xpath("./w:pPr/w:outlineLvl/@w:val")
            if not outline and paragraph.style is not None:
                outline = paragraph.style.element.xpath("./w:pPr/w:outlineLvl/@w:val")
            result.append({"type": "paragraph", "text": paragraph.text,
                           "style": paragraph.style.name if paragraph.style else None,
                           "outline_level_hint": int(outline[0]) + 1 if outline else None})
        elif element.tag == qn("w:tbl"):
            table = Table(element, document)
            result.append({"type": "table", "rows": [[cell.text for cell in row.cells] for row in table.rows]})
    return result


def inspect_template(path):
    document = Document(path)
    return {
        "file": str(path.resolve()),
        "blocks": paragraphs_in_order(document),
        "styles": [{"name": style.name, "type": str(style.type)} for style in document.styles],
        "sections": [{
            "width_cm": section.page_width.cm if section.page_width else None,
            "height_cm": section.page_height.cm if section.page_height else None,
            "margins_cm": {name: getattr(section, name).cm if getattr(section, name) is not None else None
                           for name in ("top_margin", "bottom_margin", "left_margin", "right_margin")},
            "header": [p.text for p in section.header.paragraphs],
            "footer": [p.text for p in section.footer.paragraphs],
        } for section in document.sections],
        "limitations": "仅提取正文顶层段落/表格及默认页眉页脚；不保证提取文本框、图片文字、嵌入对象或自动编号。",
    }


def style_for(document, name, kind):
    string(name, "样式名")
    require(name in document.styles, f"模板中不存在样式：{name}")
    require(document.styles[name].type == kind, f"样式类型不匹配：{name}")
    return name


def fallback_document():
    """没有用户模板时使用明确的通用版式，不宣称复现样例。"""
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin = section.bottom_margin = Cm(2.5)
    section.left_margin = section.right_margin = Cm(2.5)
    # 字体和颜色在保存前统一设置，标题也使用宋体；此处只配置基础版式。
    document.styles["Normal"].font.size = Pt(12)
    document.styles["Normal"].paragraph_format.line_spacing = 1.5
    document.add_paragraph("{{CONTENT}}")
    return document


def set_marker_text(paragraph, text):
    """标记可能被 Word 分成多个 run，保留首个 run 和段落原有格式。"""
    if paragraph.runs:
        paragraph.runs[0].text = text
        for run in paragraph.runs[1:]:
            run.text = ""
    else:
        paragraph.add_run(text)


def validate_manifest(data, base, draft):
    require(isinstance(data, dict), "清单必须是 JSON 对象")
    string(data.get("title"), "title")
    require(draft or data.get("text_finalized") is True, "最终版要求 text_finalized: true；文字未定稿请使用 --draft")
    sections = data.get("sections")
    require(isinstance(sections, list) and sections, "sections 必须是非空数组")
    figures = data.get("figures", [])
    require(isinstance(figures, list), "figures 必须是数组")
    figure_map = {}
    for figure in figures:
        require(isinstance(figure, dict), "每张图必须是对象")
        figure_id = string(figure.get("id"), "图 ID")
        require(figure_id not in figure_map, f"重复图 ID：{figure_id}")
        string(figure.get("caption"), f"{figure_id} caption")
        string(figure.get("prompt"), f"{figure_id} prompt")
        require(figure.get("status") in {"placeholder", "generated", "approved", "needs_revision"}, f"{figure_id} 的图状态无效")
        width = figure.get("width_cm", 15)
        require(type(width) in (int, float) and math.isfinite(width) and width > 0, f"{figure_id} width_cm 必须是正数")
        if figure["status"] == "approved":
            image = base / string(figure.get("image"), f"{figure_id} image")
            require(image.is_file(), f"图片文件不存在：{image}")
            require(image.suffix.lower() in {".png", ".jpg", ".jpeg"}, f"请将 {figure_id} 转为 PNG 或 JPEG")
        else:
            require(draft, f"最终版图片尚未审核通过：{figure_id}")
        figure_map[figure_id] = figure

    section_ids, referenced = set(), set()
    for section in sections:
        require(isinstance(section, dict), "每章必须是对象")
        section_id = string(section.get("id"), "章节 ID")
        require(section_id not in section_ids, f"重复章节 ID：{section_id}")
        section_ids.add(section_id)
        string(section.get("title"), f"{section_id} title")
        level(section.get("level", 1))
        blocks = section.get("blocks")
        require(isinstance(blocks, list) and blocks, f"{section_id} blocks 必须是非空数组")
        for block in blocks:
            require(isinstance(block, dict), "内容块必须是对象")
            kind = block.get("type")
            require(kind in {"paragraph", "heading", "bullet", "number", "table", "figure", "page_break"}, f"不支持的内容块：{kind}")
            if kind in {"paragraph", "heading", "bullet", "number"}:
                string(block.get("text"), f"{kind} text")
                if kind == "heading":
                    level(block.get("level"))
            elif kind == "figure":
                figure_id = string(block.get("id"), "图位 ID")
                require(figure_id in figure_map, f"正文引用了未定义的图：{figure_id}")
                referenced.add(figure_id)
            elif kind == "table":
                headers, rows = block.get("headers"), block.get("rows")
                require(isinstance(headers, list) and headers and all(isinstance(x, str) for x in headers), "表头必须是非空字符串数组")
                require(isinstance(rows, list) and all(isinstance(row, list) and len(row) == len(headers)
                        and all(isinstance(x, str) for x in row) for row in rows), "表格每行必须为字符串数组，列数须与表头一致")
    require(set(figure_map) == referenced, f"图清单存在未引用项：{sorted(set(figure_map) - referenced)}")
    # 提示词属于编辑信息；仅检查实际进入终稿的文字，避免误报提示词中的说明。
    if not draft:
        visible = [data["title"]] + [section["title"] for section in sections]
        for section in sections:
            for block in section["blocks"]:
                visible.append(block.get("text", ""))
                if block["type"] == "table":
                    visible.extend(block["headers"])
                    visible.extend(cell for row in block["rows"] for cell in row)
        visible.extend(figure["caption"] for figure in figures)
        require(not any(re.search(r"【待确认|\[待确认|\{\{FIG:|\{\{CONTENT\}\}|\{\{DOCUMENT_TITLE\}\}|\{\{OUTPUT_TIMESTAMP\}\}", text) for text in visible),
                "最终版仍有待确认标记或未转换的占位符")
    return figure_map


def build(args):
    base = args.manifest.resolve().parent
    data = json.loads(args.manifest.read_text(encoding="utf-8"))
    figures = validate_manifest(data, base, args.draft)
    timezone = ZoneInfo(data.get("timezone", "Asia/Shanghai"))
    now = datetime.now(timezone)
    stamp = now.strftime("%Y%m%d_%H%M%S_%f%z")
    title = f'{data["title"]}_{stamp}' + ("_草稿" if args.draft else "")
    document = Document(args.template) if args.template else fallback_document()
    anchors = [p for p in document.paragraphs if p.text.strip() == "{{CONTENT}}"]
    require(len(anchors) == 1, "模板正文顶层必须恰好有一个独占段落：{{CONTENT}}")
    anchor = anchors[0]
    styles = {"body": "Normal", "title": "Title", "caption": "Caption", "bullet": "List Bullet",
              "number": "List Number", "table": "Table Grid"}
    require(isinstance(data.get("styles", {}), dict), "styles 必须是对象")
    styles.update(data.get("styles", {}))
    for key, name in styles.items():
        style_for(document, name, WD_STYLE_TYPE.TABLE if key == "table" else WD_STYLE_TYPE.PARAGRAPH)

    def emit(element):
        anchor._p.addprevious(element)

    def paragraph(text, style):
        paragraph_style = style_for(document, style, WD_STYLE_TYPE.PARAGRAPH)
        p = document.add_paragraph(text, style=paragraph_style)
        emit(p._p)
        return p

    # 正文所属分节由其后第一个 sectPr 决定；不能简单使用 document.sections[-1]。
    section_properties = None
    for element in anchor._p.itersiblings():
        if element.tag == qn("w:sectPr"):
            section_properties = element
            break
        found = element.xpath("./w:pPr/w:sectPr")
        if found:
            section_properties = found[0]
            break
    section = next((s for s in document.sections if s._sectPr is section_properties), document.sections[-1])
    available_width = section.page_width - section.left_margin - section.right_margin - (section.gutter or 0)
    require(available_width > 0, "正文所在分节的页面可用宽度无效")

    title_markers = [p for p in document.paragraphs if p.text.strip() == "{{DOCUMENT_TITLE}}"]
    require(len(title_markers) <= 1, "模板中 DOCUMENT_TITLE 标记重复")
    if title_markers:
        set_marker_text(title_markers[0], title)
    else:
        paragraph(title, styles["title"])
    for p in document.paragraphs:
        if p.text.strip() == "{{OUTPUT_TIMESTAMP}}":
            set_marker_text(p, now.isoformat(timespec="microseconds"))
    document.core_properties.title = title
    # OOXML 核心属性以 UTC 存储；可见标题和文件名保留用户选择的时区。
    document.core_properties.created = now.astimezone(datetime_timezone.utc)
    document.core_properties.modified = now.astimezone(datetime_timezone.utc)

    image_count, figure_numbers = 0, {}
    for section in data["sections"]:
        paragraph(section["title"], section.get("style", f'Heading {section.get("level", 1)}'))
        for block in section["blocks"]:
            kind = block["type"]
            if kind in {"paragraph", "heading", "bullet", "number"}:
                default_style = f'Heading {block["level"]}' if kind == "heading" else styles.get(kind, styles["body"])
                paragraph(block["text"], block.get("style", default_style))
            elif kind == "page_break":
                p = document.add_page_break()
                emit(p._p)
            elif kind == "table":
                table_style = style_for(document, block.get("style", styles["table"]), WD_STYLE_TYPE.TABLE)
                table = document.add_table(rows=1, cols=len(block["headers"]), style=table_style)
                for cell, text in zip(table.rows[0].cells, block["headers"]):
                    cell.text = text
                for row in block["rows"]:
                    for cell, text in zip(table.add_row().cells, row):
                        cell.text = text
                emit(table._tbl)
            elif kind == "figure":
                figure = figures[block["id"]]
                figure_numbers.setdefault(figure["id"], len(figure_numbers) + 1)
                caption = f'图 {figure_numbers[figure["id"]]} {figure["caption"]}'
                if figure["status"] == "approved":
                    p = paragraph("", styles["body"])
                    inline = p.add_run().add_picture(str(base / figure["image"]), width=min(Cm(figure.get("width_cm", 15)), available_width))
                    inline._inline.docPr.set("descr", figure["caption"])
                    image_count += 1
                else:
                    paragraph(f'【示意图占位：{figure["id"]}】', styles["body"])
                    paragraph(f'绘图提示词：{figure["prompt"]}', styles["body"])
                paragraph(caption, styles["caption"])
    anchor._p.getparent().remove(anchor._p)

    # 让 Word 等客户端在打开时更新字段；此标记不等于已经计算目录或页码。
    settings = document.settings.element
    fields = settings.find(qn("w:updateFields"))
    if fields is None:
        fields = OxmlElement("w:updateFields")
        settings.append(fields)
    fields.set(qn("w:val"), "true")
    pending_count = format_document(document, args.draft)
    output_dir = args.output_dir or base / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", title).strip(" .")
    require(len(filename.encode("utf-8")) <= 240, "输出文件名过长；请缩短 title")
    output = output_dir / (filename + ".docx")
    # 独占创建：即使时间戳碰巧重复，也绝不覆盖旧文件。
    with output.open("xb") as handle:
        try:
            document.save(handle)
        except Exception:
            output.unlink(missing_ok=True)
            raise
    return {"file": str(output.resolve()), "title": title, "timestamp": now.isoformat(timespec="microseconds"),
            "draft": args.draft, "sections": len(data["sections"]), "image_occurrences": image_count,
            "font": "宋体", "font_color": "000000", "pending_highlight": "yellow", "pending_items": pending_count,
            "template": str(args.template.resolve()) if args.template else None,
            "layout_review": "尚未进行页面渲染检查；目录和页码字段需在文档客户端更新。"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="提取 DOCX 样例的段落、样式、表格和页面信息")
    inspect.add_argument("template", type=Path)
    inspect.add_argument("--output", type=Path)
    assemble = commands.add_parser("build", help="根据 JSON 清单组装带时间戳的 DOCX")
    assemble.add_argument("manifest", type=Path)
    assemble.add_argument("--template", type=Path)
    assemble.add_argument("--output-dir", type=Path)
    assemble.add_argument("--draft", action="store_true", help="允许未定稿文字和图片占位符")
    args = parser.parse_args()
    try:
        result = inspect_template(args.template) if args.command == "inspect" else build(args)
        payload = json.dumps(result, ensure_ascii=False, indent=2)
        if args.command == "inspect" and args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            # 同样保留既有检查结果，需要更新时由调用者选新路径。
            with args.output.open("x", encoding="utf-8") as handle:
                handle.write(payload + "\n")
        print(payload)
        return 0
    except Exception as error:
        print(f"组装/检查失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
