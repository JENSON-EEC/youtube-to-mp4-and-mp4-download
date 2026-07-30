import os
import uuid
import shutil
import threading
import time
import urllib.request
import zipfile
import io
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
import yt_dlp

app = Flask(__name__, static_folder='static', template_folder='templates')

# Configuration
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Add workspace directory to PATH so yt-dlp and shutil find local ffmpeg
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
if WORKSPACE_DIR not in os.environ['PATH']:
    os.environ['PATH'] = WORKSPACE_DIR + os.pathsep + os.environ['PATH']

# Global progress map
# Schema: { download_id: { status, percentage, speed, eta, error, filename, filepath } }
progress_map = {}
progress_lock = threading.Lock()

def download_ffmpeg_if_missing():
    """Checks if ffmpeg/ffprobe exist in the workspace, downloads them if missing."""
    ffmpeg_exe = os.path.join(WORKSPACE_DIR, 'ffmpeg.exe')
    ffprobe_exe = os.path.join(WORKSPACE_DIR, 'ffprobe.exe')
    
    if os.path.exists(ffmpeg_exe) and os.path.exists(ffprobe_exe):
        print("FFmpeg and FFprobe binaries are already present locally.")
        return
        
    print("FFmpeg/FFprobe not found. Downloading lightweight prebuilt binaries...")
    try:
        # Download ffmpeg.exe zip
        ffmpeg_url = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip"
        req = urllib.request.Request(ffmpeg_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            with zipfile.ZipFile(io.BytesIO(response.read())) as zip_ref:
                zip_ref.extractall(WORKSPACE_DIR)
            
        # Download ffprobe.exe zip
        ffprobe_url = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffprobe-4.4.1-win-64.zip"
        req = urllib.request.Request(ffprobe_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            with zipfile.ZipFile(io.BytesIO(response.read())) as zip_ref:
                zip_ref.extractall(WORKSPACE_DIR)
                
        print("FFmpeg and FFprobe successfully downloaded and configured locally.")
    except Exception as e:
        print(f"Error downloading FFmpeg dependency: {e}")

# Start background download of FFmpeg if it doesn't exist
threading.Thread(target=download_ffmpeg_if_missing, daemon=True).start()

def check_ffmpeg():
    """Checks if ffmpeg is available in system PATH or workspace folder."""
    return shutil.which('ffmpeg') is not None or os.path.exists(os.path.join(WORKSPACE_DIR, 'ffmpeg.exe'))

def clean_old_downloads():
    """Deletes files in the downloads directory that are older than 1 hour."""
    now = time.time()
    try:
        for filename in os.listdir(DOWNLOAD_DIR):
            filepath = os.path.join(DOWNLOAD_DIR, filename)
            # Avoid cleaning active downloads
            if os.path.getmtime(filepath) < now - 3600:
                if os.path.isfile(filepath):
                    os.remove(filepath)
                elif os.path.isdir(filepath):
                    shutil.rmtree(filepath)
    except Exception as e:
        print(f"Cleanup error: {e}")

@app.route('/')
def index():
    # Run a quick cleanup on home page load
    clean_old_downloads()
    return render_template('index.html')

@app.route('/api/info', methods=['POST'])
def get_video_info():
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'URL is required'}), 400
    
    url = data['url']
    ffmpeg_present = check_ffmpeg()

    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'nocheckcertificate': True
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Extract relevant metadata
            metadata = {
                'title': info.get('title', 'Unknown Title'),
                'thumbnail': info.get('thumbnail', ''),
                'duration': info.get('duration', 0),
                'channel': info.get('uploader', 'Unknown Channel'),
                'views': info.get('view_count', 0),
                'ffmpeg_installed': ffmpeg_present,
                'formats': []
            }

            # Filter and prepare download format options
            formats_added = set()
            
            # Always expose premium and standard formats since FFmpeg is downloaded automatically on startup
            metadata['formats'].append({
                'id': 'best_video_audio',
                'label': 'Best Quality (Up to 1080p/4K MP4)',
                'requires_ffmpeg': True,
                'extension': 'mp4'
            })
            metadata['formats'].append({
                'id': 'best_premerged_mp4',
                'label': 'Standard Quality (Up to 720p MP4)',
                'requires_ffmpeg': False,
                'extension': 'mp4'
            })
            metadata['formats'].append({
                'id': 'mp3_audio',
                'label': 'Audio Only (MP3)',
                'requires_ffmpeg': True,
                'extension': 'mp3'
            })
            metadata['formats'].append({
                'id': 'native_audio',
                'label': 'Audio Only (M4A)',
                'requires_ffmpeg': False,
                'extension': 'm4a'
            })

            # Inspect available direct streams to offer standard quality options
            for f in info.get('formats', []):
                height = f.get('height')
                ext = f.get('ext')
                vcodec = f.get('vcodec')
                acodec = f.get('acodec')

                # Only include formats that have resolution height and are mp4
                if height and ext == 'mp4':
                    # Pre-merged format (has both audio and video)
                    is_premerged = (vcodec != 'none' and acodec != 'none')
                    
                    if height in [360, 720] and is_premerged:
                        label = f"{height}p MP4 (Pre-merged)"
                        fid = f"premerged_{height}p"
                        if fid not in formats_added:
                            metadata['formats'].append({
                                'id': fid,
                                'label': label,
                                'requires_ffmpeg': False,
                                'extension': 'mp4'
                            })
                            formats_added.add(fid)
                    elif height in [1080, 1440, 2160] and ffmpeg_present:
                        label = f"{height}p Full HD MP4 (Muxed)"
                        fid = f"muxed_{height}p"
                        if fid not in formats_added:
                            metadata['formats'].append({
                                'id': fid,
                                'label': label,
                                'requires_ffmpeg': True,
                                'extension': 'mp4'
                            })
                            formats_added.add(fid)

            # Sort formats so highest quality / best options are first
            return jsonify(metadata)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

def download_worker(download_id, url, format_id):
    ffmpeg_present = check_ffmpeg()
    
    # Select download options based on the requested format_id
    # We use only download_id as the filename on disk for security and privacy.
    ydl_opts = {
        'outtmpl': os.path.join(DOWNLOAD_DIR, f'{download_id}.%(ext)s'),
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
    }

    if format_id == 'best_video_audio':
        ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
    elif format_id == 'mp3_audio':
        ydl_opts['format'] = 'bestaudio/best'
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }]
    elif format_id == 'best_premerged_mp4':
        ydl_opts['format'] = 'best[ext=mp4]/best'
    elif format_id == 'native_audio':
        ydl_opts['format'] = 'bestaudio/best'
    elif format_id.startswith('premerged_'):
        height = format_id.split('_')[1].replace('p', '')
        # Try to find a premerged format with the specific height
        ydl_opts['format'] = f'best[height={height}][ext=mp4]/best[height={height}]/best'
    elif format_id.startswith('muxed_'):
        height = format_id.split('_')[1].replace('p', '')
        ydl_opts['format'] = f'bestvideo[height={height}][ext=mp4]+bestaudio[ext=m4a]/best[height={height}]/best'
    else:
        # Default fallback
        ydl_opts['format'] = 'best[ext=mp4]/best'

    # Progress hook
    def progress_hook(d):
        with progress_lock:
            if d['status'] == 'downloading':
                downloaded = d.get('downloaded_bytes', 0)
                total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                percentage = (downloaded / total * 100) if total > 0 else 0
                speed = d.get('speed', 0)  # bytes/second
                eta = d.get('eta', 0)      # seconds
                
                progress_map[download_id].update({
                    'status': 'downloading',
                    'percentage': round(percentage, 1),
                    'speed': speed,
                    'eta': eta
                })
            elif d['status'] == 'finished':
                progress_map[download_id].update({
                    'status': 'processing',
                    'percentage': 100
                })

    ydl_opts['progress_hooks'] = [progress_hook]

    try:
        # Initial status
        with progress_lock:
            progress_map[download_id] = {
                'status': 'downloading',
                'percentage': 0,
                'speed': 0,
                'eta': 0,
                'filepath': None,
                'filename': None
            }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # We run extract_info to get the final path and start download
            info = ydl.extract_info(url, download=True)
            
            # Locate the downloaded file
            # yt-dlp provides information about downloaded files. If it was merged or postprocessed,
            # the final filepath is in `info.get('requested_downloads')` or we can find it in DOWNLOAD_DIR.
            filepath = None
            req_downloads = info.get('requested_downloads', [])
            if req_downloads:
                filepath = req_downloads[0].get('filepath')
            
            # Fallback path finding if not explicitly returned
            if not filepath or not os.path.exists(filepath):
                # Search for files starting with download_id in the downloads folder
                for f in os.listdir(DOWNLOAD_DIR):
                    if f.startswith(download_id):
                        filepath = os.path.join(DOWNLOAD_DIR, f)
                        break

            if filepath and os.path.exists(filepath):
                # We dynamically name the browser attachment using the true title for the user,
                # even though the server disk only stores the anonymous download_id!
                display_filename = info.get('title', 'download') + os.path.splitext(filepath)[1]
                display_filename = "".join(c for c in display_filename if c.isalnum() or c in (' ', '.', '_', '-')).strip()
                
                with progress_lock:
                    progress_map[download_id].update({
                        'status': 'completed',
                        'percentage': 100,
                        'filepath': filepath,
                        'filename': display_filename
                    })
            else:
                raise Exception("Could not find the downloaded file on disk.")

    except Exception as e:
        with progress_lock:
            progress_map[download_id] = {
                'status': 'error',
                'error': str(e)
            }

@app.route('/api/download/start', methods=['POST'])
def start_download():
    data = request.get_json()
    if not data or 'url' not in data or 'format' not in data:
        return jsonify({'error': 'URL and format are required'}), 400
    
    url = data['url']
    format_id = data['format']
    download_id = str(uuid.uuid4())

    # Initialize task status
    with progress_lock:
        progress_map[download_id] = {
            'status': 'starting',
            'percentage': 0,
            'speed': 0,
            'eta': 0
        }

    # Start download worker thread
    thread = threading.Thread(target=download_worker, args=(download_id, url, format_id))
    thread.daemon = True
    thread.start()

    return jsonify({'download_id': download_id})

@app.route('/api/download/progress/<download_id>', methods=['GET'])
def get_download_progress(download_id):
    with progress_lock:
        status_info = progress_map.get(download_id)
    
    if not status_info:
        return jsonify({'error': 'Invalid or expired download ID'}), 404
        
    return jsonify(status_info)

@app.route('/api/download/file/<download_id>', methods=['GET'])
def get_download_file(download_id):
    with progress_lock:
        status_info = progress_map.get(download_id)
        
    if not status_info:
        return jsonify({'error': 'Invalid or expired download ID'}), 404
        
    if status_info['status'] != 'completed':
        return jsonify({'error': 'File is not ready for download'}), 400
        
    filepath = status_info['filepath']
    filename = status_info['filename']
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found on server disk'}), 404
        
    # Get extension
    ext = os.path.splitext(filepath)[1].lower()
    mimetype = 'audio/mpeg' if ext == '.mp3' else ('audio/mp4' if ext == '.m4a' else 'video/mp4')

    # Generator to stream and immediately delete file for user privacy
    def generate_and_cleanup():
        try:
            with open(filepath, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            try:
                os.remove(filepath)
                # Clean up session progress information
                with progress_lock:
                    if download_id in progress_map:
                        del progress_map[download_id]
                print(f"Secured Privacy: Successfully deleted download file {download_id} from disk.")
            except Exception as e:
                print(f"Error executing secure file cleanup: {e}")

    return app.response_class(
        generate_and_cleanup(),
        mimetype=mimetype,
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
    )

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
