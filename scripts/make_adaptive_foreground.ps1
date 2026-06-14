Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot '..\assets\icon.png'
$outPath = Join-Path $PSScriptRoot '..\assets\icon_foreground.png'

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$size = 1024
$scale = 0.72
$drawSize = [int]($size * $scale)
$offset = [int](($size - $drawSize) / 2)

$out = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.SmoothingMode = 'HighQuality'
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode = 'HighQuality'
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($src, $offset, $offset, $drawSize, $drawSize)

$out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$out.Dispose()
$src.Dispose()

Write-Host "Wrote $outPath"
