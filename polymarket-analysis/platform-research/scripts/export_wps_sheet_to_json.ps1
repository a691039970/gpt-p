param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [int]$WorksheetIndex = 1
)

$ket = $null
$workbook = $null

try {
  $resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
  $outputDir = Split-Path -Parent $OutputPath
  if ($outputDir) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  }

  $ket = New-Object -ComObject Ket.Application
  $ket.Visible = $false
  $ket.DisplayAlerts = $false

  $workbook = $ket.Workbooks.Open($resolvedInput)
  $worksheet = $workbook.Worksheets.Item($WorksheetIndex)
  $usedRange = $worksheet.UsedRange

  $rowCount = $usedRange.Rows.Count
  $colCount = $usedRange.Columns.Count

  $headers = @()
  for ($col = 1; $col -le $colCount; $col++) {
    $headers += [string]$usedRange.Item(1, $col).Text
  }

  $rows = @()
  for ($row = 2; $row -le $rowCount; $row++) {
    $obj = [ordered]@{}
    $hasValue = $false

    for ($col = 1; $col -le $colCount; $col++) {
      $header = $headers[$col - 1]
      if ([string]::IsNullOrWhiteSpace($header)) {
        $header = "Column$col"
      }
      $value = [string]$usedRange.Item($row, $col).Text
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        $hasValue = $true
      }
      $obj[$header] = $value
    }

    if ($hasValue) {
      $rows += [pscustomobject]$obj
    }
  }

  $payload = [pscustomobject]@{
    exportedAt = (Get-Date).ToUniversalTime().ToString("o")
    sourceFile = $resolvedInput
    worksheet = $worksheet.Name
    rowCount = $rows.Count
    headers = $headers
    rows = $rows
  }

  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  Write-Output $OutputPath
}
finally {
  if ($workbook) {
    try { $workbook.Close($false) } catch {}
  }
  if ($ket) {
    try { $ket.Quit() } catch {}
  }
}
