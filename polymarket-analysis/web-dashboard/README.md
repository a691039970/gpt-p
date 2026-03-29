# Web Dashboard

Run the local semi-automatic dashboard:

```powershell
node D:\gpt\polymarket-analysis\web-dashboard\server.js
```

Then open:

```text
http://127.0.0.1:3187
```

The dashboard will:

- fetch recent trades for the target wallet
- classify signals as `follow`, `observe`, or `skip`
- suggest unit sizes
- let you log paper trades manually
