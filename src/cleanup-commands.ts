export const mediaExtensions=['.mp4','.webm','.mov','.m4v','.png','.jpg','.jpeg','.webp','.wav','.mp3','.flac','.ogg','.m4a'];
const linuxRoot="output_dir='/workspace/runpod-slim/ComfyUI/output'\n[ -d \"$output_dir\" ] || { echo 'Output folder not found. Check ComfyUI output path.'; exit 1; }";
const match='\\( '+mediaExtensions.map(ext=>`-iname '*${ext}'`).join(' -o ')+' \\)';
const psRoot=String.raw`$OutputDir = Join-Path $env:LOCALAPPDATA 'Comfy-Desktop\ComfyUI-Shared\output'
# Portable example: $OutputDir = 'C:\ComfyUI_windows_portable\ComfyUI\output'
# For a different installation, replace the first line with its actual output folder.
if (!(Test-Path -LiteralPath $OutputDir -PathType Container)) { throw 'Output folder not found. Check ComfyUI output path.' }
$Extensions = @(${mediaExtensions.map(ext=>`'${ext}'`).join(', ')})
$Files = @(Get-ChildItem -LiteralPath $OutputDir -File -Recurse | Where-Object { $Extensions -contains $_.Extension.ToLowerInvariant() })`;
export const cleanupCommands={
 runpod:[
  {title:'1. Check output size and list media',code:`${linuxRoot}\ndu -sh -- "$output_dir"\nfind "$output_dir" -type f ${match} -printf '%s\\t%p\\n' | sort -nr | head -40`},
  {title:'2. Find and delete one file',code:`${linuxRoot}\n# Replace this example with the exact filename from the list.\nfind "$output_dir" -type f -name 'REPLACE_WITH_FILENAME.mp4' -print -ok rm -- {} \\;`},
  {title:'3. Clear all generated output media',code:`${linuxRoot}\nfind "$output_dir" -type f ${match} -print\nread -r -p 'Type DELETE to permanently remove ALL listed output media: ' answer\nif [ "$answer" = 'DELETE' ]; then\n  find "$output_dir" -type f ${match} -delete\n  du -sh -- "$output_dir"\nelse\n  echo 'Cancelled. No files deleted.'\nfi`},
 ],
 local:[
  {title:'1. Check output size and list media',code:`${psRoot}\n$Files | Sort-Object LastWriteTime -Descending | Select-Object FullName,Length,LastWriteTime\n'{0} media files, {1:N2} GB' -f $Files.Count,(($Files | Measure-Object Length -Sum).Sum / 1GB)`},
  {title:'2. Find and delete one file',code:`${psRoot}\n$FileName = 'REPLACE_WITH_FILENAME.mp4'\n$Files | Where-Object Name -eq $FileName | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Confirm }`},
  {title:'3. Clear all generated output media',code:`${psRoot}\n$Files | Select-Object FullName,Length\n$Answer = Read-Host 'Type DELETE to permanently remove ALL listed output media'\nif ($Answer -ceq 'DELETE') {\n  $Files | ForEach-Object { Remove-Item -LiteralPath $_.FullName -ErrorAction Stop }\n  Write-Host 'Output media cleared.'\n} else { Write-Host 'Cancelled. No files deleted.' }`},
 ],
};

// A missing path exits only this subshell, not the user’s terminal session.
for(const command of cleanupCommands.runpod)command.code=`(\n${command.code}\n)`;
