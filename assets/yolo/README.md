# 本地 YOLOv8 炒面检测

权重：`best.pt`（类别 Spaghetti）  
脚本：`detect_spaghetti.py`

## 安装依赖（本机 Python 3.9+）

```bash
pip install ultralytics opencv-python-headless
```

## 测试

```bash
python yolo/detect_spaghetti.py --weights yolo/best.pt --image 某张.jpg
```

软件设置 → AI 对接 → 开启「本地 YOLO」后，内部监控会周期性抓拍并检测炒面。
