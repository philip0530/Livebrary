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

## 오라클 무료 서버

공개 HTTPS 주소는 Oracle Cloud Always Free 가상 서버와 DuckDNS 이름으로 만듭니다. 예: `https://livebrary.duckdns.org`.

1. [Oracle Cloud](https://cloud.oracle.com)에서 Always Free로 가입합니다. 홈 리전은 나중에 바꿀 수 없습니다. 한국이면 Chuncheon을 고릅니다.
2. Compute에서 Ubuntu 24.04 인스턴스를 만듭니다. 형태는 Ampere `VM.Standard.A1.Flex` 1 OCPU, 메모리 6GB입니다. 용량 오류가 나면 다른 가용 도메인을 고르거나 `VM.Standard.E2.1.Micro`를 씁니다. 공개 IPv4를 켜고 SSH 키를 저장합니다.
3. 서브넷 보안 목록에 TCP 80과 443을 `0.0.0.0/0`에서 허용합니다. 22번 외의 포트, 특히 5432는 열지 않습니다.
4. [DuckDNS](https://www.duckdns.org)에서 서브도메인을 만들고, 그 IP를 서버 공개 IP로 넣습니다. 토큰을 복사합니다.
5. 이 컴퓨터를 묶어서 서버로 보냅니다.

```powershell
powershell -File deploy/oracle/pack.ps1
scp -i 키파일.pem $env:TEMP\livebrary-deploy.tar ubuntu@공개IP:~/
```

6. 서버에서 풀고 설치합니다. 호스트 이름, 운영자 이메일, 사용자 이름, 비밀번호, DuckDNS 토큰을 묻습니다.

```bash
ssh -i 키파일.pem ubuntu@공개IP
mkdir -p ~/livebrary && tar -xf ~/livebrary-deploy.tar -C ~/livebrary
cd ~/livebrary
sudo bash deploy/oracle/setup.sh
```

설치가 끝나면 `https://입력한-호스트이름` 으로 접속합니다. 인증서가 나오기까지 DNS가 잡힌 뒤 1분 정도 걸릴 수 있습니다. 앱은 `127.0.0.1:3001`만 듣고, 바깥에는 Caddy가 443으로 연결합니다.

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
