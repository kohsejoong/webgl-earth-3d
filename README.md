# webgl-earth-3d

순수 WebGL(외부 그래픽 라이브러리 없음)로 구현한 3D 지구 모델입니다. 위/경도 1° 격자 구에 NASA 공개 고도 자료를 샘플링해 지형을 실제 정점 변위로 표현하고, 자전과 태양 방향에 따른 조명(낮/밤, 계절) 변화를 보여줍니다.

## 실행 방법

텍스처를 CDN(jsDelivr)에서 CORS로 불러오므로 로컬 서버로 실행하는 것을 권장합니다(인터넷 연결 필요).

```bash
python -m http.server 8000
```

이후 `http://localhost:8000` 접속. 드래그로 회전, 휠로 확대/축소.

## 기능

- **지형**: 위/경도 → 고도맵 픽셀 샘플링, 반지름 방향 변위, 고도 과장 배율(0~100×)
- **회전 운동**: 자전축 23.44° 기울기, 자전 속도 조절
- **조명 변화**: 태양 방향(공전 각도) 조절/자동 이동, Phong 조명(주변광·확산광·바다 반사광), 밤 쪽 도시 불빛
- **지표 색상**: 위성 영상(Blue Marble) / 고도별 색상(Hypsometric)
- URL 쿼리로 초기값 지정 가능: `?exag=80&sunAngle=270&spinSpeed=0`

## 자료 출처

NASA Blue Marble, Black Marble, Topography 영상 (three-globe 예제 이미지, jsDelivr CDN)

## 파일 구성

- `index.html` — 페이지 레이아웃 및 컨트롤 UI
- `earth.js` — WebGL 초기화, 셰이더, 격자/지형 생성, 행렬, 렌더 루프
