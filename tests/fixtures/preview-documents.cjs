exports.score='\\title "Preview test"\n\\tempo 100\n.\n:4 0.6 2.6 3.6 0.5 | 2.5 3.5 0.4 2.4 |\n';
exports.musicxml='<?xml version="1.0" encoding="utf-8"?><score-partwise version="3.1"><work><work-title>XML preview</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
exports.guitarPro=function(source=exports.score){const alpha=require('@coderline/alphatab'),importer=new alpha.importer.AlphaTexImporter();importer.initFromString(source,new alpha.Settings());return Buffer.from(new alpha.exporter.Gp7Exporter().export(importer.readScore()));};
exports.pdf=function({width=300,height=200}={}){
  const stream=t=>`BT /F1 24 Tf 40 ${height-100} Td (${t}) Tj ET`,objects=[
    '<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...[6,7].map(id=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents ${id} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['First page','Second page'].map(t=>`<< /Length ${stream(t).length} >>\nstream\n${stream(t)}\nendstream`),
  ];let source='%PDF-1.4\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(source.length);source+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const start=source.length;return source+`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${start}\n%%EOF`;
};
