#!/usr/bin/env python3
"""在临时目录验证 Word 实际输出，不修改模板原件或用户的标书文件。"""

import hashlib
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.shared import Cm, Pt, RGBColor

from assemble_docx import build


class WordFormattingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tender-word-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.data = {
            "title": "技术方案", "text_finalized": True,
            "sections": [{"id": "1", "title": "总体方案", "blocks": [
                {"type": "paragraph", "text": "已确认的正文。"},
                {"type": "bullet", "text": "能力说明"},
                {"type": "table", "headers": ["参数", "取值"], "rows": [["带宽", "已确认"]]},
            ]}],
        }

    def assemble(self, template=None, draft=True):
        manifest = self.base / "document.json"
        manifest.write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")
        return build(Namespace(manifest=manifest, template=template, draft=draft, output_dir=None))

    def assert_all_text_formatted(self, path):
        # 检查 ZIP 包内的实际 XML，涵盖 python-docx 不通过 paragraph.runs 暴露的文字。
        with ZipFile(path) as archive:
            for name in archive.namelist():
                if not name.startswith("word/") or not name.endswith(".xml"):
                    continue
                root = parse_xml(archive.read(name))
                for run in root.iter(qn("w:r")):
                    self.assertIsNotNone(run.find(qn("w:rPr")), name)
                for properties in root.iter(qn("w:rPr")):
                    fonts, color = properties.find(qn("w:rFonts")), properties.find(qn("w:color"))
                    self.assertIsNotNone(fonts, name)
                    self.assertIsNotNone(color, name)
                    for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
                        self.assertEqual(fonts.get(qn(f"w:{attribute}")), "宋体", name)
                    self.assertEqual(color.attrib, {qn("w:val"): "000000"}, name)
                    self.assertFalse(any(key.endswith("Theme") or key.endswith("theme") for key in fonts.attrib), name)

    def test_fallback_and_final_output(self):
        result = self.assemble(draft=False)
        self.assert_all_text_formatted(result["file"])
        document = Document(result["file"])
        self.assertEqual(document.core_properties.title, result["title"])
        self.assertIn(result["title"], [p.text for p in document.paragraphs])
        self.assertEqual(result["pending_items"], 0)
        self.assertEqual(document.tables[0].cell(1, 1).text, "已确认")
        # 字体统一后列表仍使用正常的圆点，而不是依赖 Symbol 字体的私用字符。
        labels = document.part.numbering_part.element.iter(qn("w:lvlText"))
        self.assertNotIn("\uf0b7", [node.get(qn("w:val")) for node in labels])

    def test_pending_text_is_precisely_highlighted(self):
        self.data["sections"][0]["blocks"][0]["text"] = "前文【待确认：带宽】后文[待确认：速率]结尾"
        self.data["sections"][0]["blocks"][2]["rows"][0][1] = "【待确认：单位】"
        result = self.assemble()
        document = Document(result["file"])
        paragraph = next(p for p in document.paragraphs if p.text.startswith("前文"))
        self.assertEqual([(run.text, run.font.highlight_color) for run in paragraph.runs], [
            ("前文", None), ("【待确认：带宽】", WD_COLOR_INDEX.YELLOW),
            ("后文", None), ("[待确认：速率]", WD_COLOR_INDEX.YELLOW), ("结尾", None),
        ])
        self.assertEqual(document.tables[0].cell(1, 1).paragraphs[0].runs[0].font.highlight_color, WD_COLOR_INDEX.YELLOW)
        self.assertEqual(result["pending_items"], 3)
        self.assert_all_text_formatted(result["file"])

    def test_template_split_runs_headers_hyperlinks_and_raw_part(self):
        template = Document()
        template.sections[0].left_margin = Cm(3.1)
        template.styles["Heading 1"].font.color.rgb = RGBColor(255, 0, 0)
        template.styles["Heading 1"].font.size = Pt(19)
        template.add_paragraph("{{DOCUMENT_TITLE}}", style="Title")
        paragraph = template.add_paragraph()
        paragraph.add_run("前文【待").bold = True
        paragraph.add_run("确认：带").italic = True
        paragraph.add_run("宽】后文")
        # 模拟 Word 中独立超链接的文字，不能用重写整段文本的方式破坏它。
        link = OxmlElement("w:hyperlink")
        link.set(qn("w:anchor"), "目标")
        run, text = OxmlElement("w:r"), OxmlElement("w:t")
        text.text = "链接【待确认：地址】尾部"
        run.append(text)
        link.append(run)
        paragraph._p.append(link)
        template.sections[0].header.paragraphs[0].add_run("页眉【待确认：单位】")
        template.sections[0].footer.paragraphs[0].add_run("页脚")
        template.add_table(rows=1, cols=1).cell(0, 0).text = "模板表格"
        template.add_paragraph("{{CONTENT}}")
        # 清除主题字体、主题色也是要求的一部分，而不只是修改 font.name。
        for run in paragraph.runs:
            run.font.name = "Arial"
            run.font.color.rgb = RGBColor(255, 0, 0)
            run._r.rPr.rFonts.set(qn("w:asciiTheme"), "majorHAnsi")
            run._r.rPr.color.set(qn("w:themeColor"), "accent1")
        # 批注等 XML 可能作为普通 Part 加载，保存前也应统一格式和高亮。
        comment = Part(PackURI("/word/comments.xml"),
                       "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
                       b'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                       + '<w:comment w:id="0"><w:p><w:r><w:t>【待确认：备注】</w:t></w:r></w:p></w:comment></w:comments>'.encode(),
                       template.part.package)
        template.part.relate_to(comment, RT.COMMENTS)
        path = self.base / "template.docx"
        template.save(path)
        original_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        result = self.assemble(path)
        self.assert_all_text_formatted(result["file"])
        document = Document(result["file"])
        paragraph = next(p for p in document.paragraphs if p.text.startswith("前文"))
        self.assertEqual(paragraph.text, "前文【待确认：带宽】后文链接【待确认：地址】尾部")
        self.assertTrue(paragraph.runs[0].bold)
        self.assertTrue(next(run for run in paragraph.runs if run.text == "确认：带").italic)
        self.assertEqual(paragraph._p.xpath("./w:hyperlink/@w:anchor"), ["目标"])
        link_runs = paragraph._p.xpath("./w:hyperlink/w:r")
        self.assertEqual([r.find(qn("w:rPr")).find(qn("w:highlight")) is not None for r in link_runs], [False, True, False])
        self.assertEqual(result["pending_items"], 4)
        self.assertEqual(document.sections[0].left_margin, template.sections[0].left_margin)
        self.assertEqual(document.styles["Heading 1"].font.size, Pt(19))
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), original_hash)

    def test_final_rejects_pending_manifest_and_template(self):
        self.data["sections"][0]["blocks"][0]["text"] = "【待确认：带宽】"
        with self.assertRaisesRegex(ValueError, "最终版仍有待确认"):
            self.assemble(draft=False)
        self.data["sections"][0]["blocks"][0]["text"] = "已确认"
        template = Document()
        template.add_paragraph("{{CONTENT}}")
        template.sections[0].footer.paragraphs[0].text = "【待确认：页脚】"
        path = self.base / "template.docx"
        template.save(path)
        with self.assertRaisesRegex(ValueError, "含模板"):
            self.assemble(path, draft=False)
        self.assertFalse((self.base / "output").exists())

    def test_unclosed_marker_is_highlighted(self):
        self.data["sections"][0]["blocks"][0]["text"] = "已确认部分【待确认：未闭合"
        result = self.assemble()
        document = Document(result["file"])
        paragraph = next(p for p in document.paragraphs if p.text.startswith("已确认部分"))
        self.assertIsNone(paragraph.runs[0].font.highlight_color)
        self.assertEqual(paragraph.runs[1].font.highlight_color, WD_COLOR_INDEX.YELLOW)


if __name__ == "__main__":
    unittest.main()
