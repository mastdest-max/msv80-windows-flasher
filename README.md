# msv80-windows-flasher

Browser bench for BMW MSV80 and other E-series modules.

- K+DCAN over the USB serial lead
- xHP Wi-Fi adapter through `public/xhp-bridge.py`
- Live data logger
- Module identification, fault memory, and nettodata coding

## Run

```bash
npm install
npm run dev
```

Open the site in Chrome or Edge on the computer the lead is plugged into. For the xHP adapter, join its Wi-Fi and run `python public/xhp-bridge.py`, then press Connect xHP Wi-Fi.
