# Starts llama-server with the JevK5 4B GGUF on Windows.
#   .\scripts\start-model.ps1 -Server C:\llama\llama-server.exe -Model C:\models\jevk5-4b-v0.3-Q4_K_M.gguf
# -Gpu sets how many layers go on the GPU. 99 means all of them; lower it if you run out of VRAM.
param(
  [string]$Server = "llama-server",
  [string]$Model = "jevk5-4b-v0.3-Q4_K_M.gguf",
  [int]$Gpu = 99,
  [int]$Context = 4096,
  [int]$Port = 8080
)
& $Server -m $Model -c $Context -ngl $Gpu -np 1 --port $Port --host 127.0.0.1
