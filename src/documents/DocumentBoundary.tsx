import { Component, type ReactNode } from 'react';
export class DocumentBoundary extends Component<{
  children: ReactNode;
  retry(): void;
  close(): void;
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className='editor-loading' role='alert'>
      <p>文档显示失败：{this.state.error.message}</p>
      <button className='secondary-button' onClick={this.props.retry}>重试</button>
      <button className='text-button' onClick={this.props.close}>关闭文档</button>
    </div>;
  }
}
