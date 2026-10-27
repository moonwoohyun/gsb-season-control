// 이 파일만 고치면 됩니다. 설정 방법은 README.md를 보세요.
window.APP_CONFIG = {
  // 구글 클라우드에서 만든 OAuth 클라이언트 ID. 비워 두면 샘플 데이터로 화면만 확인하는 '데모 모드'로 열립니다.
  CLIENT_ID: "",

  // 시즌마다 파일이 하나입니다.
  //  sheetId     : 시즌 생산관리 시트 주소의 /d/ 와 /edit 사이 값
  //  costSheetId : 원가·판가만 따로 둔 시트 (권한 있는 사람만 공유). 없으면 비워 두세요.
  SEASONS: [
    { label: "26FW", sheetId: "", costSheetId: "" }
  ]
};
