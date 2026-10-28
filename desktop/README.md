# MSV Bench for Windows

This is the Windows program. It is the same bench as the site: cable, logger, bus, tests, coding, repository, and inspect. It is not a picture of Windows inside the browser.

Unzip `MSV-Bench-Windows.zip` and open `MSV Bench.exe`. Windows may say the publisher is unknown because the program is not signed. Choose Run anyway.

To build it yourself, from the project folder:

```bat
npm install
npm run desktop:dist
```

Plug the K+DCAN lead in, choose Cable, and press Connect. Windows asks which cable to use. For the xHP adapter, join its Wi-Fi and press Connect xHP Wi-Fi. The app opens the adapter port itself. You do not run the Python bridge.

Files you add in Repository are stored in your Windows user data folder, not in the website.
