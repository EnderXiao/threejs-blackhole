# DESIGN — Kerr Black Hole Flight

## 1. Concept + Subject

**Subject**: 一台可自由飞行的「相对论观测台」——玩家在宇宙画布中环绕一颗自旋的 Kerr 黑洞，亲眼看到光、物质与时空被吸入、弯曲、拖曳。

**Tone**: 冷峻科研仪器 × 电影级宇宙奇观。数据在 HUD 上冷静跳动，画面中心却是超现实的引力剧场。

**Style anchor（一句话）**:
> *Scientific-observatory HUD × Cinematic GR render：EHT/Interstellar 式测地线光线追踪 + 近等宽科研 HUD 读数。*

- 2D：极简科研 HUD / Swiss 栅格，几乎无装饰
- 3D：程序化测地线光线追踪（非 PBR 模型）+ 发光吸积盘 + 透镜星空

## 2. Inspiration DNA

| 维度 | 取自 | 落地 |
|------|------|------|
| 材质 | 黑洞阴影、光子环、炽热吸积盘 | 着色器体积盘 + 发光光子环 |
| 运动 | 缓慢差速自转、螺旋吸入、参考拖曳 | Ω(r)=1/(r^{3/2}+a)、粒子 plunge |
| 色彩 | 深空近黑 + 盘面橙金 + 仪器青 | 见色板 |
| 构图 | 主体占满视野、阴影偏心（自旋） | 默认相机 25° 倾角俯视盘 |
| 交互 | 自由飞行 + 参数可调 | WASD/鼠标 + 自旋/倾角/质量滑杆 |

## 3. Palette + Typography

### Palette

| Token | Hex | 用途 |
|-------|-----|------|
| `--bg` | `#05060A` | 宇宙底色 |
| `--ink` | `#E8EEF5` | 主文字 |
| `--ink-dim` | `#8B9BB0` | 次级文字 |
| `--accent` | `#FFB84D` | 吸积盘 / 高亮 |
| `--accent-hot` | `#FFE2A0` | 盘内缘高温 |
| `--accent-cool` | `#C45C26` | 远离侧红移 |
| `--hud` | `#6EE7FF` | HUD 线条 / 坐标 |
| `--danger` | `#FF5A5A` | 视界 / 警告 |

### Typography

- UI / 正文：`"SF Pro Text", "Segoe UI", "PingFang SC", system-ui, sans-serif`
- 数据 / 坐标：`"SF Mono", "JetBrains Mono", "Cascadia Code", ui-monospace, monospace`
- 比例：HUD 标签 11px/500 tracking 0.08em；读数 13px mono；标题 28–40px/600

## 4. Layout System

- **全屏 WebGL 画布**为唯一场景层（same-layer for the universe）。
- HUD 为 **different-layer** 浮层：四角信息块，不挡阴影中心。
- 间距：8px 网格；面板圆角 8px，半透明 `rgba(5,6,10,0.55)` + 1px `rgba(110,231,255,0.18)` 描边。
- 底部居中：操作提示 + 参数滑杆（自旋 a、观察距离、质量感）。
- 右上：实时物理读数（r/Ω/红移 g、是否处于能层内）。

## 5. Signature Moments

1. **光子环锁焦** — 相机接近时光子环细亮，阴影边缘不对称（自旋）。
2. **Interstellar 弧** — 盘的背面次级像从阴影上方弯过，随飞行持续变形。

## 6. Interaction List

| 触发 | 视觉变化 |
|------|----------|
| 鼠标拖拽 / Pointer Lock | 自由视角旋转（惯性阻尼） |
| WASD / QE | 相对视向平移；Shift 加速 |
| 滚轮 | 沿视向 dolly |
| 滑杆 a | 改变自旋 → ISCO/阴影/拖曳同步变 |
| 滑杆 倾角 | 盘相对相机的倾角 |
| 滑杆 质量/缩放 | 尺度感 |
| 空格 | 暂停/继续物质吸入动画 |
| H | 显示/隐藏 HUD |
| R | 重置相机到默认观测位 |

## 7. Tech Stack

- **three.js**（WebGL2）全屏三角形 + 片元光线反向追踪零测地线（Kerr，RK4）
- 自定义 GLSL：阴影、光子环、透镜星空、吸积盘发射、多普勒/引力红移
- 吸积盘：解析发射面（穿过 r∈[r_ISCO, r_out] 的赤道面）+ 粒子螺旋吸入
- 时空扭曲：透镜星场 + 可选测地线网格线（调试）
- 无 GSAP/Lenis（自由飞行模式，非滚动叙事）；纯 DOM HUD
- **完全离线**：three 本地打包，无 CDN

## 8. Priority

**Core must-do**
1. Kerr 光线弯曲 + 非对称阴影 + 光子环
2. 吸积盘 + 次级像 + 多普勒/引力红移着色
3. 自由飞行相机
4. 物质粒子螺旋吸入
5. HUD 物理读数 + 自旋参数

**Optional bonus**
- 测地线调试网格 / 流线
- 音频嗡鸣随 r 变化
- 截图模式（隐藏 HUD）
- 预设镜头（极向 / 赤道 / 临界轨道）
