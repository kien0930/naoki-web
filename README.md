# Hanamura Naoki — trang web riêng

Trang chat với Naoki cho bất kỳ ai có link, không cần đăng nhập Claude.

- `public/` — trang Live2D (bản dựng từ artifact, không có thông tin cá nhân của chủ trang)
- `api/chat.js` — hàm Vercel giữ API key ở server, chỉ nhận đúng prompt của Naoki, giới hạn lượt chat
- `shim.js` — thay `window.claude` của artifact bằng lệnh gọi `/api/chat`

## Biến môi trường (Vercel → Settings → Environment Variables)

| Tên | Bắt buộc | Mặc định |
|---|---|---|
| `ANTHROPIC_API_KEY` | có | — |
| `MODEL_QUICK` | không | `claude-haiku-5-5` |
| `MODEL_DEEP` | không | `claude-sonnet-5-5` |
| `LIMIT_PER_10MIN` | không | 12 tin / người / 10 phút |
| `LIMIT_PER_DAY` | không | 60 tin / người / ngày |
| `LIMIT_GLOBAL_DAY` | không | 400 tin / ngày (mỗi instance) |

Nhớ đặt giới hạn chi tiêu (spend limit) trong console.anthropic.com.
