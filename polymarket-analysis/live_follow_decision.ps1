param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$OutputDir = ".\output",

    [string]$Wallet = "0x490b4fE78B2FB36f733FeF1b340759e03500eec9"
)

$ErrorActionPreference = "Stop"

function Get-CategoryTierUnit {
    param(
        [string]$Category,
        [double]$Size
    )

    switch ($Category) {
        "Basketball" {
            if ($Size -lt 666) { return 1.0 }
            if ($Size -lt 835) { return 1.5 }
            if ($Size -lt 1160) { return 2.0 }
            return 2.5
        }
        "CS2" {
            if ($Size -lt 249) { return 1.0 }
            if ($Size -lt 802) { return 1.5 }
            if ($Size -lt 1509) { return 2.0 }
            return 2.5
        }
        "Dota2" {
            if ($Size -lt 205) { return 1.0 }
            if ($Size -lt 400) { return 1.5 }
            if ($Size -lt 571) { return 2.0 }
            return 2.5
        }
        "LoL" {
            if ($Size -lt 243) { return 1.0 }
            if ($Size -lt 352) { return 1.5 }
            if ($Size -lt 394) { return 2.0 }
            return 2.5
        }
        default {
            return 0.0
        }
    }
}

function Get-TimeMultiplier {
    param(
        [double]$MinutesBeforeStart
    )

    if ($MinutesBeforeStart -lt 0) { return 0.7 }
    if ($MinutesBeforeStart -le 60) { return 1.0 }
    if ($MinutesBeforeStart -le 180) { return 0.8 }
    return 0.6
}

function Get-Decision {
    param(
        $Row
    )

    $allowedCategories = @("Basketball", "CS2", "Dota2", "LoL")
    $category = [string]$Row.category
    $price = [double]$Row.price
    $size = [double]$Row.size
    $minutes = [double]$Row.minutesBeforeStart
    $slug = [string]$Row.slug

    if ($allowedCategories -notcontains $category) {
        return [pscustomobject]@{
            decision = "skip"
            reason = "category_not_in_trial"
            baseUnits = 0
            timeMultiplier = 0
            finalUnits = 0
            key = $slug
        }
    }

    if ($price -lt 0.1) {
        return [pscustomobject]@{
            decision = "skip"
            reason = "price_too_low"
            baseUnits = 0
            timeMultiplier = 0
            finalUnits = 0
            key = $slug
        }
    }

    $baseUnits = Get-CategoryTierUnit -Category $category -Size $size
    if ($baseUnits -le 0) {
        return [pscustomobject]@{
            decision = "skip"
            reason = "tier_not_defined"
            baseUnits = 0
            timeMultiplier = 0
            finalUnits = 0
            key = $slug
        }
    }

    $timeMultiplier = Get-TimeMultiplier -MinutesBeforeStart $minutes
    $finalUnits = [math]::Round(($baseUnits * $timeMultiplier), 2)

    $decision = "follow"
    $reason = "trial_rule_match"
    if ($timeMultiplier -lt 1.0) {
        $decision = "observe"
        $reason = "time_discounted"
    }

    [pscustomobject]@{
        decision = $decision
        reason = $reason
        baseUnits = $baseUnits
        timeMultiplier = $timeMultiplier
        finalUnits = $finalUnits
        key = $slug
    }
}

$resolvedInput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InputPath)
$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$parsed = Get-Content -Raw $resolvedInput | ConvertFrom-Json
$rows = if ($parsed -is [System.Array]) { @($parsed) } else { @($parsed) }

$latestPerMarket = $rows |
    Sort-Object {[datetime]$_.tradeTimeUtc} -Descending |
    Group-Object slug |
    ForEach-Object { $_.Group | Select-Object -First 1 }

$decisions = foreach ($row in $latestPerMarket) {
    $decision = Get-Decision -Row $row
    [pscustomobject]@{
        wallet = $Wallet
        tradeTimeUtc = $row.tradeTimeUtc
        gameStartTimeUtc = $row.gameStartTimeUtc
        minutesBeforeStart = [double]$row.minutesBeforeStart
        category = $row.category
        title = $row.title
        slug = $row.slug
        outcome = $row.outcome
        price = [double]$row.price
        size = [double]$row.size
        decision = $decision.decision
        reason = $decision.reason
        baseUnits = $decision.baseUnits
        timeMultiplier = $decision.timeMultiplier
        finalUnits = $decision.finalUnits
    }
}

$ordered = $decisions | Sort-Object {[datetime]$_.tradeTimeUtc} -Descending
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedInput)
$jsonPath = Join-Path $resolvedOutputDir "${baseName}_live_decisions.json"
$txtPath = Join-Path $resolvedOutputDir "${baseName}_live_decisions.txt"

$ordered | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
$ordered |
    Select-Object tradeTimeUtc,category,title,price,size,minutesBeforeStart,decision,reason,finalUnits |
    Format-Table -Wrap |
    Out-String |
    Set-Content -LiteralPath $txtPath -Encoding UTF8

$ordered |
    Select-Object -First 20 tradeTimeUtc,category,title,price,size,minutesBeforeStart,decision,reason,finalUnits |
    Format-Table -Wrap
