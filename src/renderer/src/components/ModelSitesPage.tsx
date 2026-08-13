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

const GROUPS: ModelGroup[] = [
  {
    title: '国内厂家模型库',
    blurb: '打印机厂商官方商城 / MakerWorld 类平台，含机型适配模型与活动文件。',
    sites: [
      {
        name: '拓竹 MakerWorld',
        url: 'https://makerworld.com/zh',
        desc: 'Bambu Lab 官方社区，模型、配置档、打印配置齐全。',
        tags: ['拓竹', 'FDM']
      },
      {
        name: '创想三维 Creality Cloud',
        url: 'https://www.crealitycloud.com/',
        desc: '创想官方模型与云切片生态。',
        tags: ['创想', 'FDM']
      },
      {
        name: '纵维立方 Anycubic Cloud',
        url: 'https://cloud.anycubic.com/',
        desc: 'Anycubic 官方云平台与模型资源。',
        tags: ['纵维', 'FDM', '光固化']
      },
      {
        name: '爱乐酷 Elegoo 官网',
        url: 'https://www.elegoo.com/',
        desc: '光固化机型资料、固件与官方模型入口。',
        tags: ['爱乐酷', '光固化']
      },
      {
        name: '闪铸 Flashforge',
        url: 'https://www.flashforge.com.cn/',
        desc: '闪铸官方产品与资源入口。',
        tags: ['闪铸']
      },
      {
        name: '快造科技 Snapmaker',
        url: 'https://snapmaker.com/',
        desc: '三合一设备官方站点与社区资源。',
        tags: ['Snapmaker']
      },
      {
        name: '普罗森 Raise3D Idea',
        url: 'https://www.raise3d.com/',
        desc: '工业向机型与官方资源。',
        tags: ['Raise3D']
      },
      {
        name: '极光尔沃 JGAurora / 极光',
        url: 'https://www.jgaurora.cn/',
        desc: '国产品牌机型与资料站。',
        tags: ['极光尔沃']
      }
    ]
  },
  {
    title: '大型综合模型站（国内常用）',
    blurb: '体量大、分类全，适合找日常打印件、手办底座、实用工具件。',
    sites: [
      {
        name: '拓竹 MakerWorld（中文）',
        url: 'https://makerworld.com/zh',
        desc: '目前国内使用频率很高的综合模型社区。',
        tags: ['综合', '热门']
      },
      {
        name: '3D 溜溜网',
        url: 'https://www.3d66.com/',
        desc: '大型 3D 模型库，覆盖打印与渲染素材。',
        tags: ['综合', '素材']
      },
      {
        name: '三维网 3DWang',
        url: 'https://www.3dwang.com/',
        desc: '中文三维模型下载与交流。',
        tags: ['综合']
      },
      {
        name: 'CG 模型网',
        url: 'https://www.cgmodel.com/',
        desc: '偏设计与可视化，也有可打印资源。',
        tags: ['设计', '素材']
      },
      {
        name: '站酷海洛 / 三维资源',
        url: 'https://www.zcool.com.cn/',
        desc: '设计社区，可检索三维与打印相关作品。',
        tags: ['设计社区']
      },
      {
        name: 'Thingiverse 镜像检索（Google）',
        url: 'https://www.google.com/search?q=site%3Athingiverse.com',
        desc: '不便直连时，可用搜索引擎按站点检索模型。',
        tags: ['检索']
      }
    ]
  },
  {
    title: '国外主流模型网站',
    blurb: '国际常用免费 / 付费模型平台，注意网络与授权协议。',
    sites: [
      {
        name: 'Printables',
        url: 'https://www.printables.com/',
        desc: 'Prusa 官方社区，模型质量与打印配置较好。',
        tags: ['Prusa', '免费']
      },
      {
        name: 'Thingiverse',
        url: 'https://www.thingiverse.com/',
        desc: '老 MakerBot 平台，模型数量巨大、历史悠久。',
        tags: ['经典', '免费']
      },
      {
        name: 'MyMiniFactory',
        url: 'https://www.myminifactory.com/',
        desc: '手办 / 桌游 / 可打印精品较多，含付费内容。',
        tags: ['手办', '付费']
      },
      {
        name: 'Cults3D',
        url: 'https://cults3d.com/',
        desc: '设计师店铺型平台，原创与付费模型丰富。',
        tags: ['付费', '设计师']
      },
      {
        name: 'Thangs',
        url: 'https://thangs.com/',
        desc: '支持 3D 搜索，适合按形状找相似模型。',
        tags: ['搜索', '免费']
      },
      {
        name: 'GrabCAD',
        url: 'https://grabcad.com/library',
        desc: '工程零件库，偏机械结构与工业件。',
        tags: ['工程', 'CAD']
      },
      {
        name: 'Sketchfab',
        url: 'https://sketchfab.com/',
        desc: '在线 3D 浏览与下载，注意授权与是否可打印。',
        tags: ['浏览', '授权']
      },
      {
        name: 'Pinshape',
        url: 'https://pinshape.com/',
        desc: '打印向社区与模型分享。',
        tags: ['社区']
      },
      {
        name: 'YouMagine',
        url: 'https://www.youmagine.com/',
        desc: '开源硬件友好的模型分享站。',
        tags: ['开源']
      },
      {
        name: 'NIH 3D Print Exchange',
        url: 'https://3dprint.nih.gov/',
        desc: '生物医学相关开放模型（科研向）。',
        tags: ['科研', '开放']
      },
      {
        name: 'MakerWorld（国际）',
        url: 'https://makerworld.com/',
        desc: '拓竹国际站，与中文站内容互通为主。',
        tags: ['拓竹']
      },
      {
        name: 'Creality Cloud（国际）',
        url: 'https://www.crealitycloud.com/',
        desc: '创想国际云平台入口。',
        tags: ['创想']
      }
    ]
  },
  {
    title: '光固化 / 手办向',
    blurb: '树脂机常用角色、底座、支撑友好模型站。',
    sites: [
      {
        name: 'MyMiniFactory',
        url: 'https://www.myminifactory.com/',
        desc: '树脂手办与桌游件资源多。',
        tags: ['树脂', '手办']
      },
      {
        name: 'Cults3D',
        url: 'https://cults3d.com/',
        desc: '大量角色与收藏向付费模型。',
        tags: ['树脂', '付费']
      },
      {
        name: 'Gambody',
        url: 'https://gambody.com/',
        desc: '商业级角色组装模型（付费）。',
        tags: ['付费', '组装']
      },
      {
        name: '3D Lab Print',
        url: 'https://3dlabprint.com/',
        desc: '航模等特种可打印项目。',
        tags: ['航模']
      }
    ]
  }
]

function openSite(url: string) {
  openExternal(url)
}

export function ModelSitesPage() {
  return (
    <div className="settings-page">
      <PluginSlot name="models.header.before" />
      <PluginSlot name="models.header" replace>
        <Typography.Title level={4} className="settings-page-title">
          模型网站
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="settings-page-desc">
          厂家库、综合站与国外常用模型平台合集。点击在系统浏览器中打开；下载请遵守各站授权协议。
        </Typography.Paragraph>
      </PluginSlot>
      <PluginSlot name="models.header.after" />

      <PluginSlot name="models.groups.before" />
      {GROUPS.map((group) => (
        <div key={group.title} className="model-site-group">
          <PluginSlot name="models.group.before" context={{ groupTitle: group.title }} />
          <Typography.Title level={5} className="model-site-group-title">
            {group.title}
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="model-site-group-blurb">
            {group.blurb}
          </Typography.Paragraph>
          <PluginSlot name="models.group.grid.before" context={{ groupTitle: group.title }} />
          <div className="model-site-grid">
            {group.sites.map((site) => {
              const ctx = {
                groupTitle: group.title,
                siteName: site.name,
                url: site.url,
                tags: site.tags
              }
              return (
                <PluginSlot key={site.url + site.name} name="models.card.before" context={ctx}>
                  <PluginSlot name="models.card" replace context={ctx}>
                    <Card className="settings-card model-site-card" size="small">
                      <div className="model-site-card-head">
                        <Typography.Text strong>{site.name}</Typography.Text>
                        <PluginSlot name="models.card.actions" context={ctx}>
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
                  <PluginSlot name="models.card.after" context={ctx} />
                </PluginSlot>
              )
            })}
          </div>
          <PluginSlot name="models.group.grid.after" context={{ groupTitle: group.title }} />
          <PluginSlot name="models.group.after" context={{ groupTitle: group.title }} />
        </div>
      ))}
      <PluginSlot name="models.groups.after" />
      <PluginSlot name="models.footer" />
    </div>
  )
}
