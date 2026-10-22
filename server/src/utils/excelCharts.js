import JSZip from "jszip";

// ExcelJS can write formulas, filters and conditional formatting but not
// charts. This adds native Excel charts (DrawingML) to an ExcelJS-written
// .xlsx buffer afterwards: one drawing part per sheet, one chart part per
// chart, with the relationships and content types Excel requires. Charts
// reference live cell ranges, so they redraw if the sheet's numbers are
// edited; cached values are embedded too so viewers that don't recalculate
// still show them.
//
// charts: [{ sheet, type: "column" | "bar" | "line", title,
//            anchor: { col, row, cols, rows },          // 0-based top-left + size in cells
//            categories: { col, from, to, values },     // col letter, 1-based rows
//            series: [{ name, col, from, to, values, color }] }]

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ref = (sheet, col, from, to) => `'${sheet.replace(/'/g, "''")}'!$${col}$${from}:$${col}$${to}`;

function strCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
}
function numCache(values) {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((v, i) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "" : `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`))
    .join("")}</c:numCache>`;
}

function seriesXml(chart, s, i) {
  const fill = (s.color || "2A78D6").replace("#", "").toUpperCase();
  const tx = `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
  const cat = `<c:cat><c:strRef><c:f>${ref(chart.sheet, chart.categories.col, chart.categories.from, chart.categories.to)}</c:f>${strCache(chart.categories.values)}</c:strRef></c:cat>`;
  const val = `<c:val><c:numRef><c:f>${ref(chart.sheet, s.col, s.from, s.to)}</c:f>${numCache(s.values)}</c:numRef></c:val>`;
  if (chart.type === "line") {
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
  }
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}<c:spPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
}

const textProps = (size, bold = false, color = "64717D") =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function chartXml(chart) {
  const series = chart.series.map((s, i) => seriesXml(chart, s, i)).join("");
  const horizontal = chart.type === "bar";
  const plot =
    chart.type === "line"
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>`
      : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="60"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>`;
  const gridline = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E8ED"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`;
  const noLine = `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="15232B"/></a:solidFill></a:rPr><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${noLine}${textProps(800)}<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/>${gridline}<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${noLine}${textProps(800)}<c:crossAx val="5001"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx><c:spPr><a:noFill/></c:spPr></c:plotArea><c:legend><c:legendPos val="t"/><c:overlay val="0"/>${textProps(900)}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E8ED"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

function anchorXml({ col, row, cols, rows }, rId, id) {
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${col + cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id + 1}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

// Without this JSZip adds bare folder entries, which Excel doesn't expect.
const NO_FOLDERS = { createFolders: false };
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const emptyRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
const addRel = (xml, id, type, target) => xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`);

// Closing points of elements that come before <drawing> in a worksheet.
const BEFORE_DRAWING = ["</sheetData>", "</conditionalFormatting>", "</dataValidations>", "</hyperlinks>", "<pageMargins", "<pageSetup", "</headerFooter>", "</rowBreaks>", "</colBreaks>", "</ignoredErrors>"];
// Elements that must come after <drawing> in a worksheet (CT_Worksheet order).
const AFTER_DRAWING = ["<legacyDrawing", "<legacyDrawingHF", "<drawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"];

export async function addChartsToWorkbook(buffer, charts) {
  if (!charts.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);

  // Sheet name -> worksheet part path, via workbook.xml and its rels.
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const workbookRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const targetById = new Map([...workbookRels.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [tag.match(/Id="([^"]+)"/)[1], tag.match(/Target="([^"]+)"/)[1]]));
  const partBySheet = new Map(
    [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
      const name = tag.match(/name="([^"]+)"/)[1].replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
      const target = targetById.get(tag.match(/r:id="([^"]+)"/)[1]).replace(/^\/?xl\//, "");
      return [name, `xl/${target}`];
    })
  );

  let contentTypes = await zip.file("[Content_Types].xml").async("string");
  const bySheet = new Map();
  charts.forEach((c) => bySheet.set(c.sheet, [...(bySheet.get(c.sheet) || []), c]));

  let chartNo = 0;
  let drawingNo = 0;
  for (const [sheet, sheetCharts] of bySheet) {
    const part = partBySheet.get(sheet);
    if (!part) continue;
    drawingNo += 1;
    const drawingPath = `xl/drawings/reportDrawing${drawingNo}.xml`;
    let drawingRels = emptyRels;
    const anchors = sheetCharts.map((chart, i) => {
      chartNo += 1;
      zip.file(`xl/charts/reportChart${chartNo}.xml`, chartXml(chart), NO_FOLDERS);
      contentTypes = contentTypes.replace("</Types>", `<Override PartName="/xl/charts/reportChart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
      drawingRels = addRel(drawingRels, `rId${i + 1}`, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart", `../charts/reportChart${chartNo}.xml`);
      return anchorXml(chart.anchor, `rId${i + 1}`, i + 1);
    });
    zip.file(
      drawingPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`,
      NO_FOLDERS
    );
    zip.file(`xl/drawings/_rels/reportDrawing${drawingNo}.xml.rels`, drawingRels, NO_FOLDERS);
    contentTypes = contentTypes.replace("</Types>", `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);

    // Link the drawing from the worksheet.
    const sheetFile = part.split("/").pop();
    const relsPath = part.replace(sheetFile, `_rels/${sheetFile}.rels`);
    const sheetRels = zip.file(relsPath) ? await zip.file(relsPath).async("string") : emptyRels;
    const relId = "rIdReportDrawing1";
    zip.file(relsPath, addRel(sheetRels, relId, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing", `../drawings/reportDrawing${drawingNo}.xml`), NO_FOLDERS);

    let sheetXml = await zip.file(part).async("string");
    if (!/<worksheet[^>]*xmlns:r=/.test(sheetXml)) {
      sheetXml = sheetXml.replace("<worksheet", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    }
    // Search only past the elements that precede <drawing> - conditional
    // formatting rules (e.g. data bars) carry their own nested <extLst>.
    const from = Math.max(...BEFORE_DRAWING.map((tag) => sheetXml.lastIndexOf(tag)));
    const at = Math.min(...AFTER_DRAWING.map((tag) => sheetXml.indexOf(tag, from)).filter((i) => i >= 0));
    sheetXml = `${sheetXml.slice(0, at)}<drawing r:id="${relId}"/>${sheetXml.slice(at)}`;
    zip.file(part, sheetXml);
  }

  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
