param(
  [Parameter(Mandatory = $true)][string]$FramesDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$encoder = [System.Windows.Media.Imaging.GifBitmapEncoder]::new()
$names = @('01-github', '02-work-git', '03-unmatched')

foreach ($name in $names) {
  $framePath = Join-Path $FramesDirectory ($name + '.png')
  $source = [System.Windows.Media.Imaging.BitmapFrame]::Create(
    [uri]([System.IO.Path]::GetFullPath($framePath)),
    [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
    [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $palette = [System.Windows.Media.Imaging.BitmapPalette]::new($source, 256)
  $indexed = [System.Windows.Media.Imaging.FormatConvertedBitmap]::new(
    $source, [System.Windows.Media.PixelFormats]::Indexed8, $palette, 0)
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($indexed))
}
$destination = Join-Path $OutputDirectory 'demo.gif'
$encoded = [System.IO.MemoryStream]::new()
$animated = [System.IO.MemoryStream]::new()
try {
  $encoder.Save($encoded)
  $bytes = $encoded.ToArray()
  $offset = 13
  if ($bytes[10] -band 128) { $offset += 3 * (1 -shl (($bytes[10] -band 7) + 1)) }
  $animated.Write($bytes, 0, $offset)

  # WPF drops animation metadata on export. Add the standard GIF89a loop
  # extension and a 450-centisecond graphic-control block before each frame.
  $loop = [byte[]]@(0x21, 0xff, 11) +
    [System.Text.Encoding]::ASCII.GetBytes('NETSCAPE2.0') +
    [byte[]]@(3, 1, 0, 0, 0)
  $animated.Write($loop, 0, $loop.Length)
  while ($offset -lt $bytes.Length) {
    $start = $offset
    $kind = $bytes[$offset++]
    if ($kind -eq 0x3b) {
      $animated.WriteByte(0x3b)
      break
    }
    if ($kind -eq 0x21) {
      $label = $bytes[$offset++]
      while ($bytes[$offset] -ne 0) { $offset += 1 + $bytes[$offset] }
      $offset++
      if ($label -ne 0xf9 -and $label -ne 0xff) {
        $animated.Write($bytes, $start, $offset - $start)
      }
    } elseif ($kind -eq 0x2c) {
      $packed = $bytes[$offset + 8]
      $offset += 9
      if ($packed -band 128) { $offset += 3 * (1 -shl (($packed -band 7) + 1)) }
      $offset++ # LZW minimum code size
      while ($bytes[$offset] -ne 0) { $offset += 1 + $bytes[$offset] }
      $offset++
      $control = [byte[]]@(0x21, 0xf9, 4, 8, 0xc2, 1, 0, 0)
      $animated.Write($control, 0, $control.Length)
      $animated.Write($bytes, $start, $offset - $start)
    } else {
      throw ('Unexpected GIF block at byte ' + $start)
    }
  }
  $result = $animated.ToArray()
  [System.Text.Encoding]::ASCII.GetBytes('GIF89a').CopyTo($result, 0)
  [System.IO.File]::WriteAllBytes($destination, $result)
} finally {
  $encoded.Dispose()
  $animated.Dispose()
}
Copy-Item -LiteralPath (Join-Path $FramesDirectory '01-github.png') -Destination (Join-Path $OutputDirectory 'demo.png')
Write-Output ('Saved ' + $destination)
