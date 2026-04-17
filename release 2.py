import paramiko
import getpass
import os
from stat import S_ISDIR

# --- Cấu hình ---
source_items_str = 'configs kernels models modules routes tests utils server.js package.json package-lock.json index.js .env.production pm2.config.js'
source_items = source_items_str.split()

# username = "dev"
# remote_host = "api.toolhub.app"
# remote_path = "/home/dev/serialcommander_webapi"
# --- Cấu hình ---
username = "huyenntt" # ĐỔI TỪ 'dev' THÀNH 'huyenntt'
remote_host = "api.toolhub.app"
remote_path = "/home/huyenntt/serialcommander_webapi" # ĐỔI 'dev' THÀNH 'huyenntt'

# --- Hàm copy đệ quy ---
def sftp_recursive_put(sftp, local_dir, remote_dir):
    """
    Copy thư mục và nội dung bên trong một cách đệ quy từ cục bộ lên máy chủ từ xa.
    Đảm bảo đường dẫn đích luôn dùng forward-slash ('/').
    """
    # CHUYỂN ĐỔI: Đảm bảo remote_dir dùng '/'
    remote_dir = remote_dir.replace('\\', '/')
    print(f"  -> Đang copy thư mục: {local_dir} -> {remote_dir}")
    
    # 1. Tạo thư mục từ xa nếu chưa có
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)

    # 2. Duyệt qua nội dung thư mục cục bộ
    for entry in os.listdir(local_dir):
        local_path = os.path.join(local_dir, entry)
        # Sử dụng os.path.join (có thể tạo '\' trên Windows) và sau đó thay thế
        remote_path_entry = os.path.join(remote_dir, entry).replace('\\', '/')

        if S_ISDIR(os.stat(local_path).st_mode):
            # Nếu là thư mục, gọi đệ quy
            sftp_recursive_put(sftp, local_path, remote_path_entry)
        else:
            # Nếu là tệp, copy lên (Hành vi mặc định là ghi đè)
            print(f"     Copy tệp: {local_path} -> {remote_path_entry}")
            sftp.put(local_path, remote_path_entry)

# --- Nhập mật khẩu an toàn ---
# Ưu tiên biến môi trường DEPLOY_PASSWORD, nếu không thì hỏi trực tiếp
password = os.environ.get("DEPLOY_PASSWORD") or getpass.getpass(prompt=f"Mật khẩu tài khoản {username}: ")

# --- Thiết lập kết nối SSH ---
try:
    # ... (Khởi tạo kết nối) ...
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    # 2. Kết nối
    print(f"\nĐang kết nối đến {remote_host}...")
    client.connect(remote_host, username=username, password=password)
    print("Kết nối SSH thành công.")
    # --------------------------------------------------------

    # --- Copy tệp và thư mục (Sử dụng SFTP) ---
    print("\nĐang copy các nguồn lực cần thiết lên máy chủ từ xa...")
    sftp = client.open_sftp()
    
    # Tạo thư mục gốc từ xa nếu nó chưa tồn tại
    try:
        sftp.stat(remote_path)
    except FileNotFoundError:
        print(f"Thư mục từ xa {remote_path} không tồn tại. Đang tạo...")
        sftp.mkdir(remote_path)

    # Lặp qua danh sách source_items và sử dụng copy đệ quy nếu là thư mục
    for item in source_items:
        local_path = item
        # SỬA LỖI WINDOWS/LINUX:
        # 1. Tạo đường dẫn trên Windows
        # 2. Thay thế tất cả '\' bằng '/'
        remote_item = ".env" if item == ".env.production" else item
        remote_dest = os.path.join(remote_path, remote_item).replace('\\', '/')
        
        if os.path.isdir(local_path):
            sftp_recursive_put(sftp, local_path, remote_dest)
        elif os.path.isfile(local_path):
            print(f"  - Copy file: {item} -> {remote_dest}")
            sftp.put(local_path, remote_dest)
        else:
             print(f"  - Bỏ qua mục không tìm thấy: {item}")
            
    sftp.close()
    print("Copy hoàn tất.")

    # --- Thực hiện lệnh từ xa (tương đương Invoke-SSHCommand) ---
    def run_remote_command(command):
        # ... (Giữ nguyên) ...
        print(f"\nĐang thực thi lệnh: {command}")
        stdin, stdout, stderr = client.exec_command(command)
        print("--- Output ---")
        print(stdout.read().decode())
        print("--- Errors (nếu có) ---")
        print(stderr.read().decode())
        print("----------------")
    
    # ... (Lệnh npm install, pm2 reload, pm2 ls giữ nguyên) ...
    command_install = f"cd {remote_path} && npm install --omit=dev --legacy-peer-deps"
    run_remote_command(command_install)

    command_restart = f"cd {remote_path} && pm2 reload pm2.config.js"
    run_remote_command(command_restart)

    command_ls = f"cd {remote_path} && pm2 ls"
    run_remote_command(command_ls)
   
except paramiko.AuthenticationException:
# ... (Khối except và finally giữ nguyên) ...
    print("\nLỗi: Xác thực thất bại. Vui lòng kiểm tra lại tên người dùng và mật khẩu.")
except paramiko.SSHException as e:
    print(f"\nLỗi SSH: {e}")
except Exception as e:
    print(f"\nĐã xảy ra lỗi: {e}")
    
finally:
    if 'client' in locals() and client:
        client.close()
        print("\nĐã đóng kết nối SSH.")