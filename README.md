# Kerr Black Hole Flight

基于 **Three.js** 的 Kerr（旋转）黑洞实时观测台：自由飞行 + 零测地线光线弯曲 + 吸积盘多普勒/引力红移 + 物质螺旋吸入。

## 快速开始

```bash
npm install
npm run dev      # 开发
npm run build    # 产出 dist/
```

打开 `dist/index.html`（或 dev 服务器）后点击「进入观测台」。

## 操作

| 按键 | 作用 |
|------|------|
| 鼠标 | 视角（指针锁定） |
| WASD | 平移 |
| Q / E | 升降 |
| Shift | 加速 |
| 滚轮 | 沿视线进退 |
| Space | 暂停/继续物质演化 |
| H | 显示/隐藏 HUD |
| R | 重置相机 |

HUD 滑杆可调自旋 a/M、盘倾角、积分步数、时间流速，并可叠加时空网格。

## 物理与实现

- 文献与公式见 [RESEARCH.md](./RESEARCH.md)
- 视觉设计见 [DESIGN.md](./DESIGN.md)
- 光线：片元着色器内对光子路径做 Heun 积分  
  `a = −1.5 (x×v)² x / r⁵ + 2 v × B_g`（Schwarzschild 零测地线 + Kerr 引力磁偶极）
- 吸积盘：薄赤道盘，`Ω = 1/(r^{3/2}+a)`，多普勒集束 `D³` 与引力红移着色
- 物质粒子：ISCO 内 plunge、ISCO 外缓慢黏滞内落，近地平线参考拖曳增旋

## 目录

```
src/
  main.js              # 场景装配
  camera/FreeCamera.js # 自由飞行相机
  physics/kerr.js      # Kerr 半径 / Ω / 测地线辅助
  scene/MatterField.js # 吸入物质粒子
  shaders/blackhole.js # 测地线光线追踪 GLSL
  ui/HUD.js            # 读数与参数
```
