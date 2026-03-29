# Polymarket Wallet Analysis

This folder contains scripts for inspecting a Polymarket wallet.

## Usage

```powershell
node .\wallet_report.js 0xYourWalletAddress .\output
```

Stable option on this machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\wallet_report.ps1 -Wallet 0xYourWalletAddress -OutputDir .\output
```

The script fetches:

- current positions
- recent trades

It writes three files under the output folder:

- `<wallet>_positions.json`
- `<wallet>_trades.json`
- `<wallet>_report.txt`
