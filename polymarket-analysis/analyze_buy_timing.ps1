param(
    [Parameter(Mandatory = $true)]
    [string]$TradesPath,

    [string]$OutputDir = ".\output",

    [int]$DelayMs = 150,

    [int]$MaxRetries = 4
)

$ErrorActionPreference = "Stop"

function Invoke-JsonWithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [int]$Retries = 4
    )

    $attempt = 0
    while ($true) {
        try {
            return Invoke-RestMethod -Uri $Uri -Headers @{ Accept = "application/json" }
        } catch {
            $attempt++
            if ($attempt -ge $Retries) {
                throw
            }
            Start-Sleep -Milliseconds (500 * $attempt)
        }
    }
}

function Get-MarketTimeInfo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Slug
    )

    $uri = "https://gamma-api.polymarket.com/markets/slug/$Slug"
    $market = Invoke-JsonWithRetry -Uri $uri -Retries $MaxRetries

    $start = $null
    if ($market.gameStartTime) {
        $start = [datetimeoffset]::Parse($market.gameStartTime)
    } elseif ($market.startDateIso) {
        $start = [datetimeoffset]::Parse($market.startDateIso)
    } elseif ($market.startDate) {
        $start = [datetimeoffset]::Parse($market.startDate)
    } elseif ($market.events -and $market.events.Count -gt 0 -and $market.events[0].startTime) {
        $start = [datetimeoffset]::Parse($market.events[0].startTime)
    }

    [pscustomobject]@{
        slug = $Slug
        title = $market.question
        gameStartTime = if ($start) { $start.UtcDateTime.ToString("o") } else { $null }
        marketStart = $market.startDateIso
        endDate = $market.endDateIso
        sportsMarketType = $market.sportsMarketType
    }
}

function Get-Category {
    param(
        [string]$Title
    )

    if ($Title -match "Counter-Strike") { return "CS2" }
    if ($Title -match "Dota 2") { return "Dota2" }
    if ($Title -match "LoL:") { return "LoL" }
    if ($Title -match "Valorant") { return "Valorant" }
    if ($Title -match "Call of Duty") { return "CoD" }
    if ($Title -match "vs\." -or $Title -match "Spread:" -or $Title -match "O/U") { return "Basketball" }
    return "Other"
}

$resolvedTradesPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TradesPath)
$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$tradesRaw = Get-Content -Raw $resolvedTradesPath | ConvertFrom-Json
$buyTrades = @($tradesRaw | Where-Object { $_.side -eq "BUY" })
$uniqueSlugs = @($buyTrades.slug | Where-Object { $_ } | Sort-Object -Unique)

$marketInfoMap = @{}
$marketInfoList = New-Object System.Collections.Generic.List[object]

foreach ($slug in $uniqueSlugs) {
    try {
        $info = Get-MarketTimeInfo -Slug $slug
        $marketInfoMap[$slug] = $info
        $marketInfoList.Add($info)
    } catch {
        $marketInfoMap[$slug] = [pscustomobject]@{
            slug = $slug
            title = $null
            gameStartTime = $null
            marketStart = $null
            endDate = $null
            sportsMarketType = $null
            error = $_.Exception.Message
        }
    }
    Start-Sleep -Milliseconds $DelayMs
}

$enriched = foreach ($trade in $buyTrades) {
    $tradeTime = [DateTimeOffset]::FromUnixTimeSeconds([int64]$trade.timestamp)
    $market = $marketInfoMap[$trade.slug]
    $startTime = $null
    $minutesBeforeStart = $null

    if ($market -and $market.gameStartTime) {
        $startTime = [datetimeoffset]::Parse($market.gameStartTime)
        $minutesBeforeStart = [math]::Round(($startTime - $tradeTime).TotalMinutes, 2)
    }

    [pscustomobject]@{
        timestamp = $trade.timestamp
        tradeTimeUtc = $tradeTime.UtcDateTime.ToString("o")
        title = $trade.title
        slug = $trade.slug
        category = Get-Category -Title $trade.title
        outcome = $trade.outcome
        price = [double]$trade.price
        size = [double]$trade.size
        gameStartTimeUtc = if ($startTime) { $startTime.UtcDateTime.ToString("o") } else { $null }
        minutesBeforeStart = $minutesBeforeStart
    }
}

$timedTrades = @($enriched | Where-Object { $null -ne $_.minutesBeforeStart })

$bucketed = $timedTrades | Group-Object {
    $m = [double]$_.minutesBeforeStart
    if ($m -lt 0) { "After start" }
    elseif ($m -lt 15) { "0-15m" }
    elseif ($m -lt 60) { "15-60m" }
    elseif ($m -lt 180) { "1-3h" }
    elseif ($m -lt 720) { "3-12h" }
    elseif ($m -lt 1440) { "12-24h" }
    else { "24h+" }
} | Sort-Object Name

$categorySummary = $timedTrades | Group-Object category | Sort-Object Count -Descending | ForEach-Object {
    $items = $_.Group
    [pscustomobject]@{
        Category = $_.Name
        Trades = $items.Count
        AvgMinutesBeforeStart = [math]::Round((($items | Measure-Object -Property minutesBeforeStart -Average).Average), 2)
        MedianApproxMinutesBeforeStart = [math]::Round((($items | Sort-Object minutesBeforeStart)[[int]($items.Count / 2)].minutesBeforeStart), 2)
    }
}

$bucketSummary = $bucketed | ForEach-Object {
    [pscustomobject]@{
        Bucket = $_.Name
        Trades = $_.Count
    }
}

$topClosest = $timedTrades | Sort-Object {[math]::Abs([double]$_.minutesBeforeStart)} | Select-Object -First 20

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedTradesPath)
$marketInfoPath = Join-Path $resolvedOutputDir "${baseName}_market_times.json"
$enrichedPath = Join-Path $resolvedOutputDir "${baseName}_buy_timing.json"
$categorySummaryPath = Join-Path $resolvedOutputDir "${baseName}_buy_timing_by_category.txt"
$bucketSummaryPath = Join-Path $resolvedOutputDir "${baseName}_buy_timing_buckets.txt"

$marketInfoList | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $marketInfoPath -Encoding UTF8
$enriched | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $enrichedPath -Encoding UTF8
$categorySummary | Format-Table -AutoSize | Out-String | Set-Content -LiteralPath $categorySummaryPath -Encoding UTF8
$bucketSummary | Format-Table -AutoSize | Out-String | Set-Content -LiteralPath $bucketSummaryPath -Encoding UTF8

"Buy trades: $($buyTrades.Count)"
"Timed buy trades: $($timedTrades.Count)"
""
"By category"
$categorySummary | Format-Table -AutoSize
""
"By time bucket"
$bucketSummary | Format-Table -AutoSize
""
"Closest to start"
$topClosest | Select-Object tradeTimeUtc,gameStartTimeUtc,minutesBeforeStart,title,price,size | Format-Table -AutoSize
