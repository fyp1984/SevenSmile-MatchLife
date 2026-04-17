---
name: "7smile-ui"
description: "Applies '七笑果' (SevenSmile) brand UI design guidelines. Invoke when designing web pages, UI components, or layouts for SevenSmile products."
---

# 七笑果 (SevenSmile) UI Design Guidelines

该技能用于指导并强制约束“七笑果”及旗下子产品（如 MatchLife 等）的 Web 应用前端页面和组件的 UI 视觉风格与交互布局规范。

## 1. 核心设计理念 (Core Design Philosophy)
- **基调**：亲和、运动、温暖、活泼、充满活力。
- **视觉风格**：基于暖橙色系渐变、圆润饱满的几何元素与字体。
- **交互结构**：**极简主义**，突出核心功能（如大搜索框居中），避免视觉干扰，直达用户诉求。

## 2. 色彩规范 (Color Palette)
### 主题色 (Primary Colors)
- **暖橙渐变 (Warm Orange Gradient)**：用于核心按钮、重要图标及强调性文本背景。
  - 起始色 (Top/Left)：`#FF9800` (亮橙)
  - 结束色 (Bottom/Right)：`#E63900` (橘红)
- **背景渐变 (Background Gradient)**：
  - 从顶部的淡黄/淡橙色 (`#FFF7ED`) 垂直平滑过渡到底部的纯白色 (`#FFFFFF`)。
  - 给用户轻盈、云端般的视觉感受。

### 辅助色与点缀色 (Secondary & Accent Colors)
- **虚线/点缀色**：明黄色 (`#FFC107` 或 `#FFD54F`)，用于背景中穿插的曲线虚线或小型几何图形（三角形、圆环）。
- **文字颜色**：
  - 主标题：深褐色/暗橙色 (`#4A2311` 或 `#333333`)，保证对比度与可读性。
  - 次要信息：灰橙色 (`#8C6B5D` 或 `#666666`)。
- **阴影与立体感**：
  - 主题元素带有轻微的右下角投影（Drop Shadow），以及柔和的高光（Semi-gloss highlight）和微妙的 3D 挤压效果。

## 3. 字体规范 (Typography)
- **字体风格**：使用圆润、粗笔画的展示型字体（如 `Rounded`, `PingFang SC`, `Nunito`, `Varela Round` 等无衬线圆体）。
- **特点**：
  - 标题要求厚重、饱满（Bold/ExtraBold），甚至可以带有轻微的活泼倾斜或俏皮的排版基线。
  - 正文字体需保证易读性，但同样保持无衬线的现代感。

## 4. 图形与背景元素 (Visual Elements)
- **微笑苹果 Logo**：七笑果的标志性“微笑苹果”图标，常作为页面左上角的品牌露出，或页脚的版权标识。
- **背景装饰 (Background Decors)**：
  - **云朵形状**：页面中上方可点缀柔和的云朵状浅色色块（透明度低，融入背景）。
  - **穿插曲线**：使用黄色的虚线曲线从左至右贯穿页面，增加运动感与动势。
  - **悬浮几何图形**：散落少量空心的圆形、三角形作为点缀。

## 5. 核心布局：极简搜索 (Core Layout: Search-Centric)
针对诸如“MatchLife”等以查询为核心的系统，应采用如下布局规范：
- **首屏居中大搜索框**：
  - 页面打开后，视觉中心是一个占据显著位置的圆角搜索框。
  - 搜索框需支持较大字号的 Placeholder（如：“搜索赛事名称、运动员名称、赛事日期、赛事类型”）。
  - 搜索框具有明显的 Focus 态发光或阴影效果（橙色系）。
- **多维度条件折叠/平铺**：
  - 搜索框下方或右侧提供极简的过滤标签（Pills/Chips），支持模糊或精准查询。
- **响应式与微信端适配**：
  - 优先考虑移动端（尤其是微信内置浏览器）的体验，控件触摸区域需大于 `44px`，无缝适配“七笑果-文体有料”公众号入口。

## 6. CSS / Tailwind 参考 (Code Reference)
在使用 Tailwind CSS 时，建议使用以下类名来契合品牌风格：
- **背景渐变**：`bg-gradient-to-b from-orange-50 to-white`
- **主色渐变文字**：`bg-gradient-to-br from-orange-500 to-red-600 bg-clip-text text-transparent`
- **主色按钮**：`bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full shadow-lg hover:shadow-xl hover:from-orange-400 hover:to-red-400 transition-all`
- **装饰虚线**：`border-dashed border-yellow-400`
- **卡片样式**：`bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-100`

## 总结
开发七笑果相关应用时，**务必严格应用上述规范**。任何组件库（如 Shadcn UI 等）的引入，均需将其 Border Radius 修改为 `rounded-2xl` 或 `rounded-full`，并将其 Primary Color 映射为暖橙色，以保证品牌视觉的高度一致性。