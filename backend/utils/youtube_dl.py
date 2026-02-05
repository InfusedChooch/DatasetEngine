from pathlib import Path
import yt_dlp

def download_youtube_video(url: str, output_path: Path) -> Path:
    video_file = output_path / "video.mp4"
    
    ydl_opts = {
        'format': 'best[ext=mp4][height<=720]',
        'outtmpl': str(video_file),
        'quiet': False,
        'no_warnings': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return video_file
    except Exception as e:
        raise Exception(f"Failed to download video: {str(e)}")

def is_youtube_url(url: str) -> bool:
    youtube_domains = ['youtube.com', 'youtu.be', 'www.youtube.com']
    return any(domain in url.lower() for domain in youtube_domains)