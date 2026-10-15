# Livebrary

라이브러리. Real-Time Collaborative Code Library.

여러 계정이 같은 프로젝트의 같은 파일을 동시에 고칩니다. 화면은 CMD와 IRC를 합친 터미널이고, 프로젝트 권한은 서버에서 검사합니다. 서비스 운영자만 관리자 콘솔을 씁니다. 일반 사용자를 위한 개발자 모드는 없습니다.

## 이 환경에서 확인된 것

이 작업 컴퓨터에는 Docker와 시스템 PostgreSQL이 없습니다. 로컬 실행은 `embedded-postgres`가 `127.0.0.1:54329`에 띄우는 데이터베이스를 사용합니다. 데이터 디렉터리는 사용자 홈의 `AppData/Local/livebrary/postgres`입니다. 프로젝트 경로에 한글이 있으면 Postgres 초기화가 UTF-8 오류로 멈추기 때문입니다. `docker-compose.yml`은 Docker가 있는 환경용으로 남겨 두었습니다.

Discord 봇 토큰이 없으면 감사 기록은 PostgreSQL에 남고, 채널 전송은 대기열에 쌓인 뒤 실패로 재시도합니다. 앱 자체는 계속 동작합니다.

## 실행

```bash
npm install
npm run setup:local
npm start
```

서버 주소는 `http://127.0.0.1:3001` 입니다. 같은 네트워크의 다른 기기에서는 서버가 출력한 LAN 주소를 사용합니다. 웹 화면, API, 협업 WebSocket이 이 프로세스 하나에 있습니다.

개발 중 화면만 바로 고치려면 `npm run dev:local`을 씁니다. 그때 주소는 `http://127.0.0.1:5173` 입니다.

## Render

GitHub에 이 저장소를 올린 뒤 [Render](https://render.com)에서 New, Blueprint를 고르고 이 저장소를 연결합니다. `render.yaml`이 무료 웹 서비스와 PostgreSQL을 만듭니다. 카드는 필요 없습니다.

첫 배포 전에 서비스 환경변수 `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`를 넣습니다. 비밀번호는 10자 이상이고 영문과 숫자를 포함해야 합니다. 주소는 `https://livebrary.onrender.com` 형태입니다. 15분 동안 접속이 없으면 잠들고, 다음 접속 때 약 1분 뒤에 다시 켜집니다. 무료 데이터베이스는 만든 뒤 30일이 지나면 지워집니다.

### 리얀 봇도 Render에서 24시간 돌리기

> 현재 꺼져 있습니다. Discord가 Render 무료 서버의 공유 IP를 자주 차단해(로그인 시 HTTP 429) 봇이 로그인하지 못하므로, 봇은 PC에서 돌립니다.

`RIYAN_BOT_ENABLED=true`이면 사이트 서버가 `apps/riyan-bot`의 디스코드 봇을 같이 켭니다. 봇이 꺼지면 자동으로 다시 켭니다. 봇은 사이트 DB를 같이 쓰고(`riyan_` 표), 연동 주소·연동 키·암호화 키는 자동으로 맞춰집니다.

1. Render > livebrary 서비스 > Environment > **Add from .env**에 아래 값을 붙여 넣고 저장합니다.
   `RIYAN_BOT_ENABLED=true`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_NOTICE_CHANNEL_ID`, `DISCORD_DEVELOPER_CODE_CHANNEL_ID`, `DISCORD_ACTIVITY_CHANNEL_ID`, `DISCORD_SECURITY_CHANNEL_ID`, `DISCORD_VERIFIED_ROLE_ID`(선택), `DISCORD_OPERATOR_IDS`, `LIVEBRARY_ADMIN_USER_IDS`
2. 봇이 켜져 있으면 서버가 10분마다 자기 공개 주소(`/api/health`)에 접속해 잠들지 않습니다. 따로 할 일은 없습니다. 무료 서비스 시간(월 750시간)은 서비스 1개를 24시간 돌리기에 충분합니다.
3. PC에서 돌리던 봇은 끕니다. 같은 토큰으로 두 곳에서 켜면 명령에 두 번 응답합니다.

로컬 `npm start`에서는 이 값을 켜지 않습니다.

## 오라클 무료 서버 (사이트 + 리얀 봇 24시간)

Oracle Cloud Always Free 서버 한 대에 Livebrary 사이트와 리얀 디스코드 봇을 같이 올립니다. Render와 달리 잠들지 않고, 데이터베이스도 만료되지 않습니다. 주소는 DuckDNS 이름으로 만듭니다. 예: `https://livebrary.duckdns.org`.

### 1. 서버 만들기 (처음 한 번)

1. [Oracle Cloud](https://cloud.oracle.com)에서 Always Free로 가입합니다. 카드 인증이 필요하지만 무료 범위만 쓰면 청구되지 않습니다. 홈 리전은 나중에 바꿀 수 없습니다. 한국이면 Chuncheon을 고릅니다.
2. Compute > Instances > Create instance에서 이미지는 **Ubuntu 24.04**를 고릅니다. 형태는 Ampere `VM.Standard.A1.Flex` 1 OCPU, 메모리 6GB입니다. 용량 오류가 나면 다른 가용 도메인을 고르거나 `VM.Standard.E2.1.Micro`를 씁니다. 공개 IPv4를 켜고 SSH 개인 키를 내려받아 둡니다.
3. 인스턴스의 서브넷 > 보안 목록에 TCP 80과 443을 `0.0.0.0/0`에서 허용합니다. 22번 외의 포트, 특히 5432는 열지 않습니다.
4. [DuckDNS](https://www.duckdns.org)에서 서브도메인을 만들고, IP 칸에 서버 공개 IP를 넣습니다. 토큰을 복사해 둡니다.

Oracle은 7일 동안 CPU·네트워크·메모리 사용량이 아주 낮은 무료 서버를 회수할 수 있습니다. 회수가 걱정되면 계정을 Pay As You Go로 업그레이드합니다. 무료 범위 안에서는 여전히 0원입니다.

### 2. 준비할 것

- **Render 데이터를 옮기려면**: Render 대시보드 > `livebrary` 데이터베이스 > Connect > **External Database URL**을 복사합니다. 비우면 빈 사이트로 시작합니다.
- **봇 토큰**: 토큰이 노출된 적이 있으면 [Discord Developer Portal](https://discord.com/developers/applications) > 앱 > Bot > Reset Token으로 새로 받아 PC의 `riyan-bot\riyan-bot\.env`에 먼저 넣습니다.
- **봇 관리자 ID**: 봇 `.env`의 `LIVEBRARY_ADMIN_USER_IDS`는 사이트 계정 ID입니다. Render 데이터를 옮기면 Render 쪽 운영자 계정 ID가 그대로 유지됩니다.

### 3. 묶어서 보내기 (이 PC에서)

`pack.ps1`이 사이트 코드, 바탕 화면의 `riyan-bot\riyan-bot` 봇 코드, 봇 `.env`, 봇 DB 데이터를 하나로 묶습니다. 묶음 안에 봇 토큰이 들어 있으니 보낸 뒤 지웁니다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy/oracle/pack.ps1
scp -i 키파일.key $env:TEMP\livebrary-deploy.tar ubuntu@공개IP:~/
Remove-Item $env:TEMP\livebrary-deploy.tar
```

### 4. 설치 (서버에서)

```bash
ssh -i 키파일.key ubuntu@공개IP
sudo mkdir -p /opt/livebrary && sudo tar -xf ~/livebrary-deploy.tar -C /opt/livebrary && rm ~/livebrary-deploy.tar
cd /opt/livebrary
sudo bash deploy/oracle/setup.sh
```

차례로 묻는 것: 호스트 이름(`이름.duckdns.org`), 운영자 이메일·사용자 이름·비밀번호, DuckDNS 토큰, Render External Database URL(비우면 새로 시작).

Render 데이터를 옮길 때는 운영자 이메일을 Render와 같게 넣습니다. 그러면 기존 운영자 계정과 비밀번호가 그대로 유지됩니다. 세션 비밀값이 새로 만들어지므로 사용자들은 한 번 다시 로그인해야 합니다.

설치 스크립트가 하는 일:
- 사이트: PostgreSQL, Node 22, Caddy(HTTPS)를 설치하고, 비밀값과 리얀 연동 키(`RIYAN_SYNC_KEY`)를 새로 만들어 `/etc/livebrary.env`에 저장합니다.
- 봇: 봇 전용 DB를 만들고 PC의 봇 데이터를 옮깁니다. PC `.env`를 서버용으로 바꿔 `/etc/riyan-bot.env`에 저장합니다. DB 주소와 사이트 주소는 서버 값으로 바뀌고, 연동 키는 사이트와 같은 새 값이 됩니다. 마지막으로 슬래시 명령을 등록하고 `riyan-bot` 서비스를 켭니다.

설치가 끝나면 `https://입력한-호스트이름`으로 접속합니다. DNS가 잡힌 뒤 인증서가 나오기까지 1분 정도 걸릴 수 있습니다. 앱은 `127.0.0.1:3001`만 듣고, 바깥에는 Caddy가 443으로 연결합니다.

### 5. 마무리

1. **PC의 봇을 끕니다** (봇 터미널에서 `Ctrl+C`). 켜 두면 같은 봇이 두 번 응답합니다.
2. 디스코드에서 `/상태`로 봇이 응답하는지 확인합니다.
3. 새 주소에서 가입·로그인이 되면 Render 서비스를 Suspend하거나 지웁니다.

### 서버 관리

```bash
sudo systemctl status livebrary riyan-bot      # 상태
sudo journalctl -u riyan-bot -f                # 봇 로그
sudo journalctl -u livebrary -f                # 사이트 로그
sudo systemctl restart riyan-bot               # 봇 재시작
sudo nano /etc/riyan-bot.env                   # 봇 설정 (저장 후 재시작)
```

코드를 바꾼 뒤에는 3·4단계를 다시 하면 됩니다. 이미 있는 `/etc/livebrary.env`와 `/etc/riyan-bot.env`, 데이터베이스는 그대로 유지됩니다.

`setup:local`이 `.env`를 처음 만들면 운영자 계정 `operator`와 비밀번호를 한 번 출력합니다. `.env`는 Git에 올리지 않습니다. 비밀번호를 다시 출력하지 않으므로 그때 저장하세요.

입장:

1. 검은 화면을 클릭합니다.
2. 키보드로 `join`을 입력합니다. 화면에 입력 칸은 없습니다.
3. 부팅 문구 뒤에 회원가입 또는 로그인으로 넘어갑니다.
4. 키보드를 쓸 수 없으면 화면 안의 숨은 `Livebrary 입장` 버튼을 사용합니다.

`join`은 연출용 키워드입니다. 데이터 보호는 로그인과 프로젝트 권한으로 합니다. 게이트 쿠키는 12시간입니다.

## 관리자

관리자 계정은 회원가입으로 만들 수 없습니다. 초기 계정은 `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`로 시드합니다.

콘솔에 들어가는 버튼은 없습니다. 검은 입장 화면을 클릭하고 `join` 대신 이번 주 키워드나 예비 코드를 입력한 뒤 Enter를 누릅니다. 틀리면 화면은 그대로 검은색입니다. 맞으면 관리자 로그인 화면으로 넘어갑니다. 시스템 관리자 계정으로 로그인하면 입장 코드를 적는 칸이 나옵니다. 이번 주 코드가 맞으면 15분짜리 관리자 세션이 열립니다.

```bash
npm run admin:grant -- <사용자이름>
```

코드 확인은 10분 동안 한 번만 쓸 수 있습니다. 일반 계정으로 로그인하면 거부되고 일반 사용자로만 들어갑니다. 코드 입력은 IP마다 15분에 5번까지입니다. 로그인 뒤 터미널에서는 관리자 코드를 받지 않습니다.

이미 들어와 있다면 로그아웃해야 검은 화면이 다시 나옵니다. 로그아웃은 입장 세션도 함께 끝냅니다.

이번 주 키워드 원문은 다음으로만 확인합니다.

```bash
npm run admin:code
```

서버는 키워드를 Argon2id 해시와 AES-256-GCM 암호문으로 저장합니다. 감사 로그에는 원문을 넣지 않습니다. Discord 봇과 `DISCORD_DEVELOPER_CODE_CHANNEL_ID`가 있으면 매주 월요일 00:00 KST에 그 채널로만 게시합니다.

예비 입장 코드의 초기값은 환경변수 `ADMIN_FALLBACK_CODE`이며 기본은 `Trust`입니다. 서버에는 해시만 저장하고 프론트엔드 소스에는 넣지 않습니다. 예비 코드를 써도 시스템 관리자 계정으로 로그인한 뒤 같은 코드를 칸에 다시 적어야 합니다. 운영 중에는 관리자 콘솔에서 더 긴 코드로 바꿀 수 있습니다.

TOTP, WebAuthn, Discord QR은 콘솔 입장에 쓰지 않습니다. 로그인 뒤에 나오는 코드 칸이 추가 인증입니다.

## 같이 편집

편집기는 Monaco입니다. 동시 수정은 Yjs CRDT와 Hocuspocus WebSocket으로 합칩니다. 문서 이름은 `project:{프로젝트 UUID}:file:{파일 UUID}`라서 파일 이름을 바꿔도 연결이 유지됩니다.

편집자와 소유자는 IndexedDB에 로컬 초안을 둡니다. 열람자는 읽기 전용이며 로컬 초안을 서버에 반영하지 않습니다. 권한이 빠지면 재접속 때 서버가 다시 검사합니다.

## 명령

프롬프트는 `user@livebrary:~$` 입니다. 편집기에 포커스가 있으면 터미널이 키를 가져가지 않습니다. 운영체제 명령은 실행하지 않습니다.

`/help` `/projects` `/create` `/join` `/open` `/files` `/users` `/whoami` `/clear` `/leave` `/logout` `/settings` `/nick` `/msg` `/who` `/me`

사이트 입장 `join`과 프로젝트 명령 `/join`은 다릅니다.

## 테스트

```bash
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

단위 테스트는 데이터베이스 없이 동작합니다. 통합 테스트는 로컬 Postgres를 띄운 뒤 게이트, 회원가입, 비공개 프로젝트 차단, 열람자의 삭제 거부를 확인합니다.

## 일부러 넣지 않은 것

- 원격 코드 실행
- 메일 발송. 이메일 초대는 앱 안 초대와 복사할 수 있는 링크로 처리합니다.
- WebAuthn
- 관리자의 비공개 코드 무제한 열람
- Redis. `REDIS_URL`이 있을 때만 요청 제한에 사용하고, 없으면 프로세스 메모리를 사용합니다.
- 로컬 개발용 HTTPS. 운영에서는 역방향 프록시의 HTTPS/WSS를 쓰거나 `TLS_CERT_PATH`와 `TLS_KEY_PATH`를 지정합니다.

## 환경변수

`.env.example`을 복사해 값을 채웁니다. `SESSION_SECRET`은 32자 이상, `ADMIN_CODE_ENCRYPTION_KEY`는 32바이트 base64입니다. Discord 채널 이름은 코드에 고정하지 않고 채널 ID로 지정합니다.
