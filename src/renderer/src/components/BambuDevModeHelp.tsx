import { Typography } from 'antd'

/**
 * 拓竹 ACS / 开发者模式说明（与官方 Wiki、第三方实测固件门槛对齐）
 * Wiki: https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode
 */
export function BambuDevModeHelp({ compact }: { compact?: boolean }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      <div>
        拓竹新固件启用了指令鉴权（ACS）。在<strong>未</strong>开启「仅局域网 +
        开发者模式」时：第三方软件可连上、可读状态，但风扇/加热/速度/G-code
        等控制会被拒，打印机常报「MQTT命令检测失败」。
      </div>

      <div style={{ marginTop: 10, fontWeight: 600 }}>哪些机型 / 固件需要开？</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        <li>
          <strong>A 系列</strong>（A1 / A1 mini）：固件 <code>01.05.00.00</code> 及以上
        </li>
        <li>
          <strong>P1 系列</strong>（P1P / P1S）：固件 <code>01.08.02.00</code> 及以上
        </li>
        <li>
          <strong>X1 系列</strong>（X1C / X1E 等）：固件 <code>01.08.03.00</code> 及以上
        </li>
        <li>
          <strong>H2D</strong>：固件 <code>01.01.00.01</code> 及以上
        </li>
        <li>
          <strong>P2 / H2 等新机</strong>：出厂即带开发者模式入口，控制同样需两项都开
        </li>
      </ul>
      <div style={{ marginTop: 6, color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>
        低于上表版本、且尚未推送 ACS 的旧固件：一般只需开局域网模式即可控制。一旦升级到带开发者模式的版本，就必须两项都开。固件号可在打印机「设置 → 设备 / 关于」查看。
      </div>

      {!compact ? (
        <>
          <div style={{ marginTop: 10, fontWeight: 600 }}>怎么开（打印机屏幕）</div>
          <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>
              <strong>A 系列</strong>：设置 →「仅局域网模式 / LAN Only Mode」→ 打开 → 再打开同页「开发者模式
              / Developer Mode」→ 阅读风险提示并确认启用（按钮变绿）。
            </li>
            <li>
              <strong>P1 系列</strong>：设置 → WLAN →「仅局域网 / Lan Only」→ 选是 → 下滑找到「开发者模式」→
              阅读提示后点启用（显示 ON）。
            </li>
            <li>
              <strong>X1 / H2 / P2S</strong>：左侧设置 →「LAN Only」→ 打开仅局域网（可按需开局域网直播）→
              打开「Developer Mode」→ 勾选确认风险 → 启用（按钮变绿）。
            </li>
          </ol>
          <div style={{ marginTop: 8 }}>
            开启后在同页抄写：打印机 IP、序列号、局域网访问码（Access Code）。本软件用户名固定为{' '}
            <code>bblp</code>，密码即访问码。
          </div>
        </>
      ) : (
        <div style={{ marginTop: 8 }}>
          操作路径因机型略有不同：设置里先开「仅局域网 / LAN Only」，再开「开发者模式 /
          Developer Mode」并确认风险提示。详见添加设备页完整说明。
        </div>
      )}

      <div style={{ marginTop: 8, color: '#ad6800' }}>
        注意：开启「仅局域网」后，该机将无法使用拓竹云与 Bambu Handy
        远程；固件更新需改用 U 盘/SD，或临时切回云模式。官方步骤见{' '}
        <Typography.Link
          href="https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode"
          target="_blank"
          rel="noreferrer"
        >
          Bambu Wiki · Developer Mode
        </Typography.Link>
        。
      </div>
    </div>
  )
}
