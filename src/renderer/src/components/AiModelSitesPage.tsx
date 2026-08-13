import { Button, Card, Tag, Typography } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { openExternal } from '../utils/openExternal'
import { PluginSlot } from '../plugins/PluginSlot'

type ModelSite = {
  name: string
  url: string
  desc: string
  tags?: string[]
}

type ModelGroup = {
  title: string
  blurb: string
  sites: ModelSite[]
}

/** 当前主流 AI 文生 / 图生 3D 建模平台合集 */
const GROUPS: ModelGroup[] = [
  {
    title: '主流 AI 文生 / 图生 3D',
    blurb: '文本或图片一键生成可编辑 / 可导出的 3D 模型，多数支持 STL、OBJ、GLB 等打印相关格式。',
    sites: [
      {
        name: 'Meshy',
        url: 'https://www.meshy.ai/zh',
        desc: '热门 AI 3D 生成平台，文生/图生、贴图、绑骨与动画；可对接切片软件与引擎插件。',
        tags: ['文生3D', '图生3D', '打印友好']
      },
      {
        name: 'Tripo 3D',
        url: 'https://www.tripo3d.ai/zh',
        desc: '高速文生/图生 3D，拓扑较干净，支持分割、贴图、自动绑骨与导出。',
        tags: ['文生3D', '图生3D', '绑骨']
      },
      {
        name: 'Hyper3D Rodin',
        url: 'https://hyper3d.ai/?lang=zh',
        desc: '高保真几何与 PBR 材质，适合角色与硬表面资产；支持多格式导出。',
        tags: ['高保真', '图生3D', 'PBR']
      },
      {
        name: 'Luma AI Genie',
        url: 'https://lumalabs.ai/genie',
        desc: '浏览器内快速概念生成，适合灵感草图与原型探索。',
        tags: ['概念', '免费额度']
      },
      {
        name: 'Kaedim',
        url: 'https://www.kaedim3d.com/',
        desc: '偏制作管线：AI 生成后可经人工质检，输出更接近生产可用拓扑。',
        tags: ['制作管线', '游戏资产']
      },
      {
        name: 'CSM（Common Sense Machines）',
        url: 'https://3d.csm.ai/',
        desc: '图生 3D 与资产工作流，偏游戏 / 互动内容方向。',
        tags: ['图生3D', '游戏']
      },
      {
        name: 'Sloyd',
        url: 'https://www.sloyd.ai/',
        desc: '参数化 + AI 生成道具，适合批量场景物件与可调风格资产。',
        tags: ['参数化', '道具']
      },
      {
        name: 'Spline AI',
        url: 'https://spline.design/',
        desc: '浏览器协作 3D 设计，内置 AI 能力，偏网页 / UI 三维体验。',
        tags: ['网页3D', '协作']
      },
      {
        name: 'Alpha3D',
        url: 'https://www.alpha3d.io/',
        desc: '电商向 2D 转 3D，适合商品展示与快速建档。',
        tags: ['电商', '2D→3D']
      },
      {
        name: '3D AI Studio',
        url: 'https://www.3daistudio.com/',
        desc: '一站式 AI 3D 生成与工作流工具集合。',
        tags: ['工作流', '综合']
      },
      {
        name: 'Masterpiece X',
        url: 'https://www.masterpiecex.com/',
        desc: '偏角色与 VR 创作，含 AI 建模与动画相关能力。',
        tags: ['角色', 'VR']
      },
      {
        name: 'Leonardo AI',
        url: 'https://leonardo.ai/',
        desc: '以图像生成为主，亦提供 3D / 纹理相关 AI 能力入口。',
        tags: ['图像', '纹理']
      }
    ]
  },
  {
    title: '国内 AI 3D 平台',
    blurb: '国内可访问性较好的文生 / 图生 3D 与社区入口（以官方站为准）。',
    sites: [
      {
        name: '腾讯混元 3D',
        url: 'https://3d.hunyuan.tencent.com/',
        desc: '腾讯混元文生/图生/草图转 3D，国内常用官方入口。',
        tags: ['混元', '国内', '官方']
      },
      {
        name: '通义万相',
        url: 'https://tongyi.aliyun.com/wanxiang/',
        desc: '阿里通义创作平台，含图像与三维相关生成能力入口。',
        tags: ['通义', '阿里云']
      },
      {
        name: 'LiblibAI 哩布哩布',
        url: 'https://www.liblib.art/',
        desc: '国内 AI 创作社区，可检索 3D / 模型相关工作流与资源。',
        tags: ['社区', '国内']
      },
      {
        name: 'Meshy（中文）',
        url: 'https://www.meshy.ai/zh',
        desc: 'Meshy 中文站，文生/图生与打印导出说明较全。',
        tags: ['Meshy', '中文']
      },
      {
        name: 'Tripo（中文）',
        url: 'https://www.tripo3d.ai/zh',
        desc: 'Tripo 中文站，适合快速出可打印草稿模型。',
        tags: ['Tripo', '中文']
      },
      {
        name: 'Hyper3D Rodin（中文）',
        url: 'https://hyper3d.ai/?lang=zh',
        desc: 'Rodin 中文界面入口，偏高质量资产。',
        tags: ['Rodin', '中文']
      }
    ]
  },
  {
    title: '扫描重建 / 辅助工具',
    blurb: '手机扫描、神经重建等：把真实物体变成 3D，再导入切片软件打印。',
    sites: [
      {
        name: 'Polycam',
        url: 'https://poly.cam/',
        desc: '手机 / LiDAR 扫描成模，适合实物翻模与场景重建。',
        tags: ['扫描', 'LiDAR']
      },
      {
        name: 'Luma AI（捕获）',
        url: 'https://lumalabs.ai/',
        desc: '神经辐射场 / 高斯溅射捕获，可导出网格用于后续处理。',
        tags: ['NeRF', '捕获']
      },
      {
        name: 'KIRI Engine',
        url: 'https://www.kiriengine.app/',
        desc: '摄影测量 App，多图重建网格，常用于打印翻模。',
        tags: ['摄影测量', '翻模']
      },
      {
        name: 'RealityScan / RealityCapture',
        url: 'https://www.capturingreality.com/',
        desc: '专业摄影测量方案（Epic），偏高精度重建。',
        tags: ['专业', '摄影测量']
      },
      {
        name: 'Hugging Face Spaces（3D）',
        url: 'https://huggingface.co/spaces?q=3d',
        desc: '开源 Demo 集合（Trellis、InstantMesh 等），适合体验最新研究模型。',
        tags: ['开源', '研究']
      }
    ]
  }
]

function openSite(url: string) {
  openExternal(url)
}

export function AiModelSitesPage() {
  return (
    <div className="settings-page">
      <PluginSlot name="aiModels.header.before" />
      <PluginSlot name="aiModels.header" replace>
        <Typography.Title level={4} className="settings-page-title">
          AI 建模网
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="settings-page-desc">
          主流 AI 3D 建模 / 文生图生站点合集。生成后请检查流形与壁厚再切片；点击在系统浏览器打开。
        </Typography.Paragraph>
      </PluginSlot>
      <PluginSlot name="aiModels.header.after" />

      <PluginSlot name="aiModels.groups.before" />
      {GROUPS.map((group) => (
        <div key={group.title} className="model-site-group">
          <PluginSlot name="aiModels.group.before" context={{ groupTitle: group.title }} />
          <Typography.Title level={5} className="model-site-group-title">
            {group.title}
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="model-site-group-blurb">
            {group.blurb}
          </Typography.Paragraph>
          <PluginSlot name="aiModels.group.grid.before" context={{ groupTitle: group.title }} />
          <div className="model-site-grid">
            {group.sites.map((site) => {
              const ctx = {
                groupTitle: group.title,
                siteName: site.name,
                url: site.url,
                tags: site.tags
              }
              return (
                <PluginSlot key={site.url + site.name} name="aiModels.card.before" context={ctx}>
                  <PluginSlot name="aiModels.card" replace context={ctx}>
                    <Card className="settings-card model-site-card" size="small">
                      <div className="model-site-card-head">
                        <Typography.Text strong>{site.name}</Typography.Text>
                        <PluginSlot name="aiModels.card.actions" context={ctx}>
                          <Button
                            type="link"
                            size="small"
                            icon={<LinkOutlined />}
                            onClick={() => openSite(site.url)}
                          >
                            打开
                          </Button>
                        </PluginSlot>
                      </div>
                      <Typography.Paragraph type="secondary" className="model-site-card-desc">
                        {site.desc}
                      </Typography.Paragraph>
                      {site.tags?.length ? (
                        <div className="model-site-tags">
                          {site.tags.map((t) => (
                            <Tag key={t}>{t}</Tag>
                          ))}
                        </div>
                      ) : null}
                    </Card>
                  </PluginSlot>
                  <PluginSlot name="aiModels.card.after" context={ctx} />
                </PluginSlot>
              )
            })}
          </div>
          <PluginSlot name="aiModels.group.grid.after" context={{ groupTitle: group.title }} />
          <PluginSlot name="aiModels.group.after" context={{ groupTitle: group.title }} />
        </div>
      ))}
      <PluginSlot name="aiModels.groups.after" />
      <PluginSlot name="aiModels.footer" />
    </div>
  )
}
