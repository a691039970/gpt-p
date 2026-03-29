param(
    [Parameter(Mandatory = $true)]
    [string]$Wallet,

    [string]$OutputDir = ".\output",

    [int]$PositionLimit = 50,

    [int]$TradeLimit = 100,

    [switch]$FetchAllTrades,

    [int]$TradeBatchSize = 1000,

    [int]$MaxTradeOffset = 10000
)

$ErrorActionPreference = "Stop"

function Get-Json {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri
    )

    return Invoke-RestMethod -Uri $Uri -Headers @{ Accept = "application/json" }
}

function Format-Number {
    param(
        [AllowNull()]
        $Value,
        [int]$Digits = 6
    )

    if ($null -eq $Value) {
        return "N/A"
    }

    return ([double]$Value).ToString("F$Digits")
}

function Format-Percent {
    param(
        [AllowNull()]
        $Value
    )

    if ($null -eq $Value) {
        return "N/A"
    }

    return ("{0:F2}%" -f [double]$Value)
}

function Format-DateValue {
    param(
        [AllowNull()]
        $Value
    )

    if ($null -eq $Value -or $Value -eq "") {
        return "N/A"
    }

    if ($Value -is [string] -and $Value -match "^\d+$") {
        $Value = [double]$Value
    }

    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
        $seconds = [double]$Value
        if ($seconds -gt 1000000000000) {
            return [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$seconds).UtcDateTime.ToString("o")
        }
        return [DateTimeOffset]::FromUnixTimeSeconds([int64]$seconds).UtcDateTime.ToString("o")
    }

    return ([datetime]$Value).ToUniversalTime().ToString("o")
}

function Get-Collection {
    param(
        [AllowNull()]
        $Payload
    )

    if ($Payload -is [System.Array]) {
        return $Payload
    }

    if ($null -ne $Payload.value) {
        return $Payload.value
    }

    return @()
}

function Get-AllTrades {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WalletAddress,
        [int]$BatchSize = 1000,
        [int]$MaxOffset = 10000
    )

    $allTrades = @()
    $offset = 0

    while ($offset -le $MaxOffset) {
        $uri = "https://data-api.polymarket.com/trades?user=$WalletAddress&limit=$BatchSize&offset=$offset"
        $batch = @(Get-Collection (Get-Json -Uri $uri))

        if ($batch.Count -eq 0) {
            break
        }

        $allTrades += $batch

        if ($batch.Count -lt $BatchSize) {
            break
        }

        $offset += $BatchSize
    }

    return @($allTrades)
}

$positionsUri = "https://data-api.polymarket.com/positions?user=$Wallet&limit=$PositionLimit&sortBy=CURRENT&sortDirection=DESC"
$tradesUri = "https://data-api.polymarket.com/trades?user=$Wallet&limit=$TradeLimit"

$positions = @(Get-Collection (Get-Json -Uri $positionsUri))
$trades = if ($FetchAllTrades) {
    @(Get-AllTrades -WalletAddress $Wallet -BatchSize $TradeBatchSize -MaxOffset $MaxTradeOffset)
} else {
    @(Get-Collection (Get-Json -Uri $tradesUri))
}

$totalInitialValue = ($positions | Measure-Object -Property initialValue -Sum).Sum
$totalCurrentValue = ($positions | Measure-Object -Property currentValue -Sum).Sum
$totalCashPnl = ($positions | Measure-Object -Property cashPnl -Sum).Sum
$buyCount = @($trades | Where-Object { $_.side -eq "BUY" }).Count
$sellCount = @($trades | Where-Object { $_.side -eq "SELL" }).Count
$latestTrade = $null

if ($trades.Count -gt 0) {
    $latestTrade = $trades[0]
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Wallet: $Wallet")
$lines.Add("")
$lines.Add("Current Positions")
$lines.Add("- Count: $($positions.Count)")
$lines.Add("- Total initial value: $(Format-Number $totalInitialValue)")
$lines.Add("- Total current value: $(Format-Number $totalCurrentValue)")
$lines.Add("- Total unrealized PnL: $(Format-Number $totalCashPnl)")
$lines.Add("")

for ($i = 0; $i -lt $positions.Count; $i++) {
    $item = $positions[$i]
    $lines.Add("Position $($i + 1)")
    $lines.Add("- Market: $($item.title)")
    $lines.Add("- Outcome: $($item.outcome)")
    $lines.Add("- Size: $(Format-Number $item.size)")
    $lines.Add("- Avg price: $(Format-Number $item.avgPrice)")
    $lines.Add("- Current price: $(Format-Number $item.curPrice)")
    $lines.Add("- Current value: $(Format-Number $item.currentValue)")
    $lines.Add("- Cash PnL: $(Format-Number $item.cashPnl)")
    $lines.Add("- Percent PnL: $(Format-Percent $item.percentPnl)")
    $lines.Add("- End date: $(Format-DateValue $item.endDate)")
    $lines.Add("")
}

$lines.Add("Recent Trades")
$lines.Add("- Count fetched: $($trades.Count)")
$lines.Add("- BUY trades: $buyCount")
$lines.Add("- SELL trades: $sellCount")

if ($null -ne $latestTrade) {
    $lines.Add("- Latest trade time: $(Format-DateValue $latestTrade.timestamp)")
    $lines.Add("- Latest market: $($latestTrade.title)")
    $lines.Add("- Latest side: $($latestTrade.side)")
    $lines.Add("- Latest outcome: $($latestTrade.outcome)")
    $lines.Add("- Latest price: $(Format-Number $latestTrade.price)")
    $lines.Add("- Latest size: $(Format-Number $latestTrade.size)")
}

$lines.Add("")

$sampleTrades = @($trades | Select-Object -First 10)
for ($i = 0; $i -lt $sampleTrades.Count; $i++) {
    $item = $sampleTrades[$i]
    $lines.Add("Trade $($i + 1)")
    $lines.Add("- Time: $(Format-DateValue $item.timestamp)")
    $lines.Add("- Market: $($item.title)")
    $lines.Add("- Side: $($item.side)")
    $lines.Add("- Outcome: $($item.outcome)")
    $lines.Add("- Price: $(Format-Number $item.price)")
    $lines.Add("- Size: $(Format-Number $item.size)")
    $lines.Add("- Transaction: $($item.transactionHash)")
    $lines.Add("")
}

$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$safeWallet = $Wallet.ToLower()
$positionsPath = Join-Path $resolvedOutputDir "$safeWallet`_positions.json"
$tradesPath = Join-Path $resolvedOutputDir "$safeWallet`_trades.json"
$reportPath = Join-Path $resolvedOutputDir "$safeWallet`_report.txt"

$positions | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $positionsPath -Encoding UTF8
$trades | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tradesPath -Encoding UTF8
$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8

$lines -join [Environment]::NewLine
