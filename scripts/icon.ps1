Add-Type -AssemblyName System.Drawing
$resourceDirectory = Join-Path $PSScriptRoot '../resources'
$bitmap = [System.Drawing.Bitmap]::new(1024, 1024)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#abb8fa'))
$shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$radius = 250
$shape.AddArc(0, 0, $radius, $radius, 180, 90)
$shape.AddArc(1024-$radius, 0, $radius, $radius, 270, 90)
$shape.AddArc(1024-$radius, 1024-$radius, $radius, $radius, 0, 90)
$shape.AddArc(0, 1024-$radius, $radius, $radius, 90, 90)
$shape.CloseFigure()
$graphics.FillPath($brush, $shape)
$pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#252a42'), 56)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$points = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(256,672), [System.Drawing.PointF]::new(256,352), [System.Drawing.PointF]::new(512,544), [System.Drawing.PointF]::new(768,352), [System.Drawing.PointF]::new(768,672))
$graphics.DrawLines($pen, $points)
$points2 = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(256,672), [System.Drawing.PointF]::new(512,480), [System.Drawing.PointF]::new(768,672))
$graphics.DrawLines($pen, $points2)
$bitmap.Save((Join-Path $resourceDirectory 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$small = [System.Drawing.Bitmap]::new($bitmap, 256, 256)
$stream = [System.IO.MemoryStream]::new()
$small.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $stream.ToArray()
$iconStream = [System.IO.File]::Create((Join-Path $resourceDirectory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$pngBytes.Length); $writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose(); $stream.Dispose(); $graphics.Dispose(); $brush.Dispose(); $pen.Dispose(); $shape.Dispose(); $small.Dispose(); $bitmap.Dispose()
