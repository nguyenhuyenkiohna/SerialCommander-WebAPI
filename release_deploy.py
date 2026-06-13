"""
Deploy back-end lên máy chủ api.toolhub.app (khác máy front serial.toolhub.app).

Khớp hướng dẫn thầy — không dùng user/path cũ ``dev`` / ``/home/dev/...``:
  • SSH: huyenntt @ api.toolhub.app
  • Thư mục dự án trên server: /home/huyenntt/serialcommander_webapi
  • Quyền làm việc dưới /home/huyenntt (thư mục con nằm trong đó).

Giá trị cụ thể đọc từ deploy-config.json (mặc định mẫu: deploy-config.example.json).
Sau upload: npm install --omit=dev trên server, pm2 reload pm2.config.js.

Chạy:
  python3 release_deploy.py
Hoặc: npm run deploy
Hoặc giống thứ tự thầy (build API là bước kiểm tra nhẹ + deploy): npm run release

Mật khẩu SSH: DEPLOY_PASSWORD=... hoặc nhập khi được hỏi — không commit mật khẩu.
"""
import paramiko
import getpass
import os
import json
from stat import S_ISDIR

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "deploy-config.json")


def load_config():
    if not os.path.isfile(CONFIG_PATH):
        print(
            f"Thiếu {CONFIG_PATH}\n"
            f"Sao chép: cp deploy-config.example.json deploy-config.json\n"
            f"rồi điền host/user/path (không commit deploy-config.json)."
        )
        raise SystemExit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_required(cfg, key):
    value = cfg.get(key)
    if value is None or value == "":
        raise ValueError(f"Thiếu cấu hình bắt buộc trong deploy-config.json: {key}")
    return value


def sftp_recursive_put(sftp, local_dir, remote_dir):
    remote_dir = remote_dir.replace("\\", "/")
    print(f"  -> Đang copy thư mục: {local_dir} -> {remote_dir}")

    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)

    for entry in os.listdir(local_dir):
        local_path = os.path.join(local_dir, entry)
        remote_path_entry = os.path.join(remote_dir, entry).replace("\\", "/")

        if S_ISDIR(os.stat(local_path).st_mode):
            sftp_recursive_put(sftp, local_path, remote_path_entry)
        else:
            print(f"     Copy tệp: {local_path} -> {remote_path_entry}")
            sftp.put(local_path, remote_path_entry)


def main():
    cfg = load_config()
    username = get_required(cfg, "username")
    remote_host = get_required(cfg, "remote_host")
    remote_path = get_required(cfg, "remote_path")
    source_items = cfg.get("source_items") or []
    env_upload_local = cfg.get("env_upload_local", ".env.production")
    env_remote_name = cfg.get("env_remote_name", ".env")
    allow_unknown_host = bool(cfg.get("allow_unknown_host", False))
    known_hosts_file = cfg.get("known_hosts_file")

    os.chdir(SCRIPT_DIR)

    raw_pw = os.environ.get("DEPLOY_PASSWORD") or getpass.getpass(
        prompt=f"Mật khẩu SSH cho tài khoản {username}: "
    )
    password = (raw_pw or "").strip()
    if not password:
        print("Thiếu mật khẩu SSH.")
        return 1

    client = None
    try:
        client = paramiko.SSHClient()
        if known_hosts_file:
            client.load_host_keys(os.path.expanduser(known_hosts_file))
        else:
            client.load_system_host_keys()

        if allow_unknown_host:
            print("[CẢNH BÁO] allow_unknown_host=true: sẽ tự động chấp nhận host key mới.")
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        else:
            client.set_missing_host_key_policy(paramiko.RejectPolicy())

        print(f"\nĐang kết nối đến {remote_host}...")
        client.connect(
            remote_host,
            username=username,
            password=password,
            look_for_keys=True,
            allow_agent=True,
            timeout=30,
        )
        print("Kết nối SSH thành công.")

        print("\nĐang copy các nguồn lực cần thiết lên máy chủ từ xa...")
        sftp = client.open_sftp()

        try:
            sftp.stat(remote_path)
        except FileNotFoundError:
            print(f"Thư mục từ xa {remote_path} không tồn tại. Đang tạo...")
            sftp.mkdir(remote_path)

        for item in source_items:
            local_path = item
            remote_item = env_remote_name if item == env_upload_local else item
            remote_dest = os.path.join(remote_path, remote_item).replace("\\", "/")

            if os.path.isdir(local_path):
                sftp_recursive_put(sftp, local_path, remote_dest)
            elif os.path.isfile(local_path):
                print(f"  - Copy file: {item} -> {remote_dest}")
                sftp.put(local_path, remote_dest)
            else:
                print(f"  - Bỏ qua mục không tìm thấy: {item}")

        sftp.close()
        print("Copy hoàn tất.")

        def run_remote_command(command):
            print(f"\nĐang thực thi lệnh: {command}")
            stdin, stdout, stderr = client.exec_command(command)
            print("--- Output ---")
            print(stdout.read().decode())
            print("--- Errors (nếu có) ---")
            print(stderr.read().decode())
            print("----------------")
            exit_code = stdout.channel.recv_exit_status()
            if exit_code != 0:
                raise RuntimeError(f"Lệnh thất bại (exit={exit_code}): {command}")

        command_install = f"cd {remote_path} && npm install --omit=dev --legacy-peer-deps"
        run_remote_command(command_install)

        command_preflight = f"cd {remote_path} && npm run preflight"
        run_remote_command(command_preflight)

        remote_pm2_path = cfg.get("remote_pm2_path") or remote_path
        if remote_pm2_path != remote_path:
            sync_cmd = (
                f"rsync -a --delete "
                f"--exclude node_modules --exclude logs --exclude uploads "
                f"{remote_path.rstrip('/')}/ {remote_pm2_path.rstrip('/')}/"
            )
            print(
                f"\nĐồng bộ code sang thư mục PM2 thực tế: {remote_pm2_path}"
            )
            run_remote_command(sync_cmd)

        pm2_cwd = remote_pm2_path
        command_restart = (
            f"cd {pm2_cwd} && NODE_ENV=production pm2 reload pm2.config.js --update-env"
        )
        run_remote_command(command_restart)

        command_verify = (
            f"grep -n 'session: false' {pm2_cwd}/modules/auth/authController.js | head -2"
        )
        run_remote_command(command_verify)

        command_health = (
            "sleep 2 && curl -sf http://127.0.0.1:2999/health "
            "|| curl -sf http://127.0.0.1:2999/serialcommander/health"
        )
        try:
            run_remote_command(command_health)
        except RuntimeError:
            print(
                "\n[CẢNH BÁO] Health localhost trên VPS chưa phản hồi ngay sau reload.\n"
                "  Deploy (upload + pm2 reload) có thể vẫn OK — kiểm tra từ máy dev:\n"
                "  bash scripts/verify-production-deploy.sh"
            )

        command_ls = f"pm2 ls"
        run_remote_command(command_ls)
        return 0

    except paramiko.AuthenticationException:
        print(
            "\n[LỖI] SSH: máy chủ từ chối đăng nhập (sai user/mật hoặc chính sách server).\n"
            f"  Đang thử: {username}@{remote_host}\n"
            "  Việc nên làm:\n"
            "  • Kiểm tra tay (cùng user/mật):  ssh "
            + username
            + "@"
            + remote_host
            + "\n"
            "  • Máy api.toolhub.app **khác** máy serial: mật đúng trên serial **chưa chắc** đã được tạo giống trên api — nhờ quản trị/ thầy xác nhận tài khoản trên **máy này**.\n"
            "  • Nếu dùng DEPLOY_PASSWORD: không thừa khoảng trắng; thử unset DEPLOY_PASSWORD rồi nhập mật khi script hỏi (ẩn).\n"
            "  • Nếu server chỉ cho đăng nhập bằng **SSH key** (tắt mật khẩu), cần key — script hiện chỉ hỗ trợ mật khẩu."
        )
        return 1
    except paramiko.ssh_exception.SSHException as e:
        if "not found in known_hosts" in str(e):
            print(
                "\n[LỖI] Host key chưa được tin cậy.\n"
                f"  Host: {remote_host}\n"
                "  Cách xử lý an toàn:\n"
                f"  • ssh-keyscan -H {remote_host} >> ~/.ssh/known_hosts\n"
                "  • Hoặc khai báo known_hosts_file trong deploy-config.json.\n"
                "  • Chỉ dùng allow_unknown_host=true cho môi trường thử nghiệm."
            )
            return 1
        print(f"\nLỗi SSH: {e}")
        return 1
    except Exception as e:
        print(f"\nĐã xảy ra lỗi: {e}")
        return 1

    finally:
        if client:
            client.close()
            print("\nĐã đóng kết nối SSH.")


if __name__ == "__main__":
    raise SystemExit(main())
