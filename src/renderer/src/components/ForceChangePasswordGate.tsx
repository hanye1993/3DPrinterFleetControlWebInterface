import { useState } from 'react'
import { Form, Input, Modal, Typography, message } from 'antd'
import { serverSend } from '../api/serverClient'
import { useAuthStore } from '../stores/authStore'
import type { AuthUserPublic } from '@shared/permissions'

/** Block app until default / flagged password is changed */
export function ForceChangePasswordGate() {
  const user = useAuthStore((s) => s.user)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()

  if (!user?.mustChangePassword) return null

  return (
    <Modal
      open
      closable={false}
      maskClosable={false}
      keyboard={false}
      title="必须修改密码"
      okText="保存新密码"
      cancelButtonProps={{ style: { display: 'none' } }}
      confirmLoading={busy}
      onOk={() => {
        void (async () => {
          try {
            const v = await form.validateFields()
            setBusy(true)
            const r = (await serverSend('/api/v1/auth/change-password', 'POST', {
              currentPassword: v.currentPassword,
              newPassword: v.newPassword
            })) as { ok?: boolean; user?: AuthUserPublic; message?: string }
            if (!r?.ok) throw new Error(r?.message || '改密失败')
            if (r.user) useAuthStore.setState({ user: r.user })
            else useAuthStore.setState({ user: { ...user, mustChangePassword: false } })
            message.success('密码已更新')
            form.resetFields()
          } catch (e) {
            message.error(e instanceof Error ? e.message : '改密失败')
          } finally {
            setBusy(false)
          }
        })()
      }}
    >
      <Typography.Paragraph type="warning">
        当前账号仍在使用默认或初始密码（如 admin123）。请先设置新密码后再继续使用。
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item
          name="currentPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '至少 6 位' }
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve()
                return Promise.reject(new Error('两次输入不一致'))
              }
            })
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
