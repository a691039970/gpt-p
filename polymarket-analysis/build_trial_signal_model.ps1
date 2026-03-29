param(
    [Parameter(Mandatory = $true)]
    [string]$BuyTimingPath,

    [string]$OutputDir = ".\output"
)

$ErrorActionPreference = "Stop"

$resolvedInput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($BuyTimingPath)
$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$parsed = Get-Content -Raw $resolvedInput | ConvertFrom-Json
$rows = @()
if ($parsed -is [System.Array]) {
    $rows = $parsed
} else {
    $rows = @($parsed)
}

$candidateSignals = @(
    $rows | Where-Object {
        @("Basketball", "Dota2", "CS2", "LoL") -contains [string]$_.category -and
        [double]("$($_.price)") -ge 0.2 -and
        [double]("$($_.price)") -le 0.6 -and
        [double]("$($_.minutesBeforeStart)") -ge -10 -and
        [double]("$($_.minutesBeforeStart)") -le 180
    }
)

$highConvictionSignals = @(
    $candidateSignals | Where-Object {
        (
            $_.category -eq "Basketball" -and
            [double]("$($_.minutesBeforeStart)") -ge 0 -and
            [double]("$($_.minutesBeforeStart)") -le 90
        ) -or (
            $_.category -eq "Dota2" -and
            [double]("$($_.minutesBeforeStart)") -ge -5 -and
            [double]("$($_.minutesBeforeStart)") -le 60
        ) -or (
            $_.category -eq "CS2" -and
            [double]("$($_.minutesBeforeStart)") -ge -5 -and
            [double]("$($_.minutesBeforeStart)") -le 120
        ) -or (
            $_.category -eq "LoL" -and
            [double]("$($_.minutesBeforeStart)") -ge -10 -and
            [double]("$($_.minutesBeforeStart)") -le 30
        )
    }
)

$summary = [pscustomobject]@{
    TotalBuys = $rows.Count
    CandidateSignals = $candidateSignals.Count
    HighConvictionSignals = $highConvictionSignals.Count
    CandidateSignalRate = [math]::Round(($candidateSignals.Count / [math]::Max($rows.Count, 1)) * 100, 2)
    HighConvictionRate = [math]::Round(($highConvictionSignals.Count / [math]::Max($rows.Count, 1)) * 100, 2)
}

$categoryBreakdown = $highConvictionSignals |
    Group-Object category |
    Sort-Object Count -Descending |
    ForEach-Object {
        $items = $_.Group
        [pscustomobject]@{
            Category = $_.Name
            Count = $items.Count
            AvgPrice = [math]::Round((($items | Measure-Object -Property price -Average).Average), 4)
            AvgMinutesBeforeStart = [math]::Round((($items | Measure-Object -Property minutesBeforeStart -Average).Average), 2)
        }
    }

$examples = $highConvictionSignals |
    Sort-Object minutesBeforeStart |
    Select-Object -First 30 tradeTimeUtc,gameStartTimeUtc,minutesBeforeStart,category,title,outcome,price,size

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedInput)
$summaryPath = Join-Path $resolvedOutputDir "${baseName}_trial_model_summary.txt"
$signalsPath = Join-Path $resolvedOutputDir "${baseName}_trial_signals.json"
$examplesPath = Join-Path $resolvedOutputDir "${baseName}_trial_examples.txt"

$summaryText = @()
$summaryText += "Trial model"
$summaryText += ""
$summaryText += "Rules"
$summaryText += "- Categories: Basketball, Dota2, CS2, LoL"
$summaryText += "- Price: 0.2 to 0.6"
$summaryText += "- Time window baseline: -10 to 180 minutes versus start"
$summaryText += "- High conviction windows:"
$summaryText += "  Basketball: 0 to 90 minutes before start"
$summaryText += "  Dota2: -5 to 60 minutes versus start"
$summaryText += "  CS2: -5 to 120 minutes versus start"
$summaryText += "  LoL: -10 to 30 minutes versus start"
$summaryText += ""
$summaryText += "Coverage"
$summaryText += "- Total buys: $($summary.TotalBuys)"
$summaryText += "- Candidate signals: $($summary.CandidateSignals) ($($summary.CandidateSignalRate)%)"
$summaryText += "- High conviction signals: $($summary.HighConvictionSignals) ($($summary.HighConvictionRate)%)"
$summaryText += ""
$summaryText += "High conviction by category"
$summaryText += ($categoryBreakdown | Format-Table -AutoSize | Out-String)

$summaryText | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$highConvictionSignals | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $signalsPath -Encoding UTF8
$examples | Format-Table -AutoSize | Out-String | Set-Content -LiteralPath $examplesPath -Encoding UTF8

$summaryText
