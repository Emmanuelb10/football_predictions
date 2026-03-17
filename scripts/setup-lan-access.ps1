# Run this script as Administrator in PowerShell
# Sets up port forwarding from Windows host to WSL2 for LAN access

$wslIp = (wsl -e bash -c "hostname -I | awk '{print `$1}'").Trim()
Write-Host "WSL2 IP: $wslIp" -ForegroundColor Cyan

# Remove old rules if they exist
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0 2>$null
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 2>$null

# Add port forwarding
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=$wslIp
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wslIp

# Add firewall rules
netsh advfirewall firewall delete rule name="Football Predictions API" 2>$null
netsh advfirewall firewall delete rule name="Football Predictions Frontend" 2>$null
netsh advfirewall firewall add rule name="Football Predictions API" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="Football Predictions Frontend" dir=in action=allow protocol=TCP localport=3000

# Show results
Write-Host "`nPort proxy rules:" -ForegroundColor Green
netsh interface portproxy show all

Write-Host "`nDone! The app is now accessible on your LAN at:" -ForegroundColor Green
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" }).IPAddress
Write-Host "  Frontend: http://${lanIp}:3000" -ForegroundColor Yellow
Write-Host "  API:      http://${lanIp}:3001/api/health" -ForegroundColor Yellow
