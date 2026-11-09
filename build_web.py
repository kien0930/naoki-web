import os, re, json, shutil
S='/tmp/claude-0/-home-claude/4e5561af-2d80-5c8d-a485-076c996dbd86/scratchpad'
W=S+'/naoki-web'
src=open(S+'/pub/index.html', encoding='utf-8').read()
def rep(a,b, n=1):
    global src
    assert src.count(a)==n,(a[:80],src.count(a)); src=src.replace(a,b)
# no personal details about the owner on a public site
a=src.index('const ABOUT_OWNER = `'); b=src.index('`;',a)
src=src[:a]+'const ABOUT_OWNER = ``;'+src[b+2:]
rep('Mỗi tin nhắn dùng lượt Claude của người đang chat. Lần gửi đầu tiên sẽ hỏi bạn cho phép.',
    'Naoki trả lời bằng AI. Đừng gửi thông tin riêng tư vào đây nha.')
rep('lúc này Naoki không tra mạng được (chỉ tra được khi trang mở trong app Claude trên máy tính). Nếu được nhờ tra thì nói vậy, đừng đoán thông tin mới.',
    'Naoki không tra mạng được. Nếu được nhờ tra thì nói là không tra được, đừng đoán thông tin mới.')
rep('  upstream_error:"Mất kết nối giữa chừng. Bấm Gửi lại để thử tiếp.",\n};',
    '  upstream_error:"Mất kết nối giữa chừng. Bấm Gửi lại để thử tiếp.",\n  not_configured:"Trang chưa được cắm chìa khóa Claude nên Naoki chưa nói chuyện được. Chủ trang đang sửa nha.",\n  daily_limit:"Hôm nay Naoki nói chuyện nhiều quá rồi, mai quay lại nha.",\n  bad_request:"Tin nhắn này Naoki không đọc được. Thử viết ngắn hơn nha.",\n};')
# fingerprint the server checks: the start of RULES (before any ${...})
r0=src.index('const RULES = `')+len('const RULES = `')
raw=src[r0:r0+400]
cut=min(i for i in [raw.find('\\'), raw.find('${',30), 400] if i>=0)
prefix=raw[:cut].replace('${NAME}','Hanamura Naoki')
assert '${' not in prefix and len(prefix)>120, prefix
json.dump({'prefix':prefix}, open(W+'/api/fingerprint.json','w',encoding='utf-8'), ensure_ascii=False)
shim=open(W+'/shim.js',encoding='utf-8').read()
html=('<!doctype html><html lang="vi"><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
      '<title>Hanamura Naoki</title><meta name="description" content="Trò chuyện với Hanamura Naoki, chú mèo lính ngự lâm tập sự.">'
      '<link rel="icon" href="model/portrait.jpg">'
      '<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style>'
      '<script>'+shim+'</script></head><body>'+src+'</body></html>')
pub=W+'/public'
if os.path.exists(pub): shutil.rmtree(pub)
os.makedirs(pub)
open(pub+'/index.html','w',encoding='utf-8').write(html)
for d in ['model','models','scene']:
    shutil.copytree(S+'/pub/'+d, pub+'/'+d)
print('built', os.path.getsize(pub+'/index.html'))
