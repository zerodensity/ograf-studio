# Regenerate the original CC0 procedural monitor backgrounds. Requires ffmpeg with libx264.
$ErrorActionPreference = 'Stop'
$sampleDirectory = Join-Path $PSScriptRoot '../apps/editor/public/program-samples'
New-Item -ItemType Directory -Force -Path $sampleDirectory | Out-Null

$newsFilter = '[0:v]drawgrid=width=120:height=90:thickness=1:color=0x1f4859@0.5,drawbox=x=0:y=420:w=960:h=120:color=0x07131e:t=fill,drawbox=x=0:y=419:w=960:h=2:color=0x55bdd0:t=fill[base];[base][1:v]overlay=x=-160+mod(t*140\,1120):y=0:shortest=1,format=yuv420p[v]'
& ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x081827:s=960x540:r=25:d=8' -f lavfi -i 'color=c=0x246985:s=160x540:r=25:d=8,format=rgba,colorchannelmixer=aa=0.18' -filter_complex $newsFilter -map '[v]' -an -c:v libx264 -preset veryfast -crf 25 -movflags +faststart (Join-Path $sampleDirectory 'news-studio.mp4')
if ($LASTEXITCODE -ne 0) { throw 'Failed to generate the news studio loop.' }

$entertainmentFilter = '[0:v]drawgrid=width=160:height=135:thickness=2:color=0x62386c@0.45,drawbox=x=0:y=410:w=960:h=130:color=0x110a20:t=fill,drawbox=x=0:y=408:w=960:h=2:color=0xe18bcc:t=fill[base];[base][1:v]overlay=x=960-mod(t*150\,1200):y=0:shortest=1,format=yuv420p[v]'
& ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x1c102f:s=960x540:r=25:d=8' -f lavfi -i 'color=c=0xc146ab:s=240x540:r=25:d=8,format=rgba,colorchannelmixer=aa=0.14' -filter_complex $entertainmentFilter -map '[v]' -an -c:v libx264 -preset veryfast -crf 25 -movflags +faststart (Join-Path $sampleDirectory 'entertainment-studio.mp4')
if ($LASTEXITCODE -ne 0) { throw 'Failed to generate the entertainment studio loop.' }
