# Hanamura Naoki — trang web riêng

Trang chat với Naoki cho bất kỳ ai có link, không cần đăng nhập Claude.

- `public/` — trang Live2D (bản dựng từ artifact, không có thông tin cá nhân của chủ trang)
- `api/chat.js` — hàm Vercel giữ API key ở server, chỉ nhận đúng prompt của Naoki, giới hạn lượt chat
- `shim.js` — thay `window.claude` của artifact bằng lệnh gọi `/api/chat`

## Biến môi trường (Vercel → Settings → Environment Variables)

Chỉ cần MỘT trong hai key. Có `GEMINI_API_KEY` thì dùng Gemini (miễn phí), không thì dùng Anthropic.

| Tên | Ghi chú | Mặc định |
|---|---|---|
| `GEMINI_API_KEY` | key miễn phí từ aistudio.google.com, không cần thẻ | — |
| `ANTHROPIC_API_KEY` | key trả phí từ console.anthropic.com | — |
| `MODEL_QUICK` | model cho tin thường | `gemini-flash-lite-latest` / `claude-haiku-5-5` |
| `MODEL_DEEP` | model cho câu khó | như trên / `claude-sonnet-5-5` |
| `LIMIT_PER_10MIN` | tin / người / 10 phút | 12 |
| `LIMIT_PER_DAY` | tin / người / ngày | 60 |
| `LIMIT_GLOBAL_DAY` | tin / ngày (mỗi instance) | 400 |

Gói miễn phí của Gemini: Google có thể đọc và dùng nội dung chat để cải thiện sản phẩm, và có giới hạn lượt mỗi ngày.
