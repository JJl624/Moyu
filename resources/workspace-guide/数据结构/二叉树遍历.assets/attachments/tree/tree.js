(() => {
  const order=document.body.dataset.order;
  const labels={pre:['根 → 左 → 右',['访问根','遍历左子树','遍历右子树']],in:['左 → 根 → 右',['遍历左子树','访问根','遍历右子树']],post:['左 → 右 → 根',['遍历左子树','遍历右子树','访问根']],level:['逐层 · 从左到右',['出队并访问','左孩子入队','右孩子入队']]};
  const children={A:['B','C'],B:['D','E'],C:['F','G'],D:[],E:[],F:[],G:[]};
  const positions={A:[152,20],B:[80,70],C:[224,70],D:[40,122],E:[112,122],F:[192,122],G:[264,122]};
  const steps=[],output=[];
  const add=(focus,frontier,explanation,line=-1)=>steps.push({focus,frontier:[...frontier],output:[...output],explanation,line});
  if(order==='level'){
    const queue=['A'];add(null,queue,'根节点 A 入队，从第一层开始。');
    while(queue.length){
      const id=queue.shift();output.push(id);add(id,queue,`队首 ${id} 出队，加入访问序列。`,0);
      children[id].forEach((child,index)=>{queue.push(child);add(id,queue,`${id} 的${index?'右':'左'}孩子 ${child} 入队。`,index+1);});
    }
  }else{
    add(null,[],'从根节点 A 开始，观察递归路径。');
    const walk=(id,parents=[])=>{
      const stack=[...parents,id];add(id,stack,`进入 ${id}，压入递归栈。`);
      const operations=order==='pre'?['visit','left','right']:order==='in'?['left','visit','right']:['left','right','visit'];
      operations.forEach((operation,line)=>{
        if(operation==='visit'){output.push(id);add(id,stack,`访问 ${id}，加入访问序列。`,line);}
        else{const child=children[id][operation==='left'?0:1];if(child)walk(child,stack);}
      });
      add(id,parents,parents.length?`${id} 处理完毕，返回 ${parents.at(-1)}。`:`根节点 ${id} 处理完毕。`);
    };
    walk('A');
  }
  add(null,[],`遍历完成：${output.join(' → ')}。`);
  const svg=document.querySelector('svg'),namespace='http://www.w3.org/2000/svg';
  const create=(tag,attributes)=>{const node=document.createElementNS(namespace,tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);return node;};
  for(const [parent,list]of Object.entries(children))for(const child of list){
    const [x,y]=positions[parent],[endX,endY]=positions[child];
    svg.append(create('path',{d:`M ${x} ${y+15} Q ${x} ${y+30} ${endX} ${endY-15}`,class:'edge','data-child':child,'data-parent':parent}));
  }
  for(const [id,[x,y]]of Object.entries(positions)){
    const group=create('g',{class:'node','data-node':id,transform:`translate(${x} ${y})`});
    const text=create('text',{});text.textContent=id;group.append(create('circle',{r:15}),text);svg.append(group);
  }
  document.querySelector('.rule').textContent=labels[order][0];
  document.querySelector('#frontier-label').textContent=order==='level'?'队列':'递归栈';
  const program=document.querySelector('.program');
  for(const label of labels[order][1]){const line=document.createElement('span');line.textContent=label;program.append(line);}
  let index=0,timer;
  const pause=()=>{clearInterval(timer);timer=undefined;document.querySelector('#play').textContent='播放';};
  const render=()=>{
    const step=steps[index];
    document.querySelector('#progress').textContent=`${index+1} / ${steps.length}`;
    document.querySelector('#explanation').textContent=step.explanation;
    document.querySelector('#frontier').textContent=step.frontier.join(' → ')||'空';
    document.querySelector('#output').replaceChildren(...step.output.map(id=>{const chip=document.createElement('span');chip.textContent=id;return chip;}));
    for(const node of svg.querySelectorAll('.node')){node.classList.toggle('visited',step.output.includes(node.dataset.node));node.classList.toggle('current',step.focus===node.dataset.node);}
    for(const edge of svg.querySelectorAll('.edge'))edge.classList.toggle('active',order!=='level'&&step.frontier.includes(edge.dataset.child)&&step.frontier.includes(edge.dataset.parent));
    [...program.children].forEach((line,i)=>line.classList.toggle('active',i===step.line));
    document.querySelector('#previous').disabled=index===0;document.querySelector('#next').disabled=index===steps.length-1;
    svg.setAttribute('aria-label',`二叉树，当前${step.focus?'节点 '+step.focus:'无活动节点'}，已访问 ${step.output.join('、')||'无'}`);
    if(index===steps.length-1)pause();
  };
  document.querySelector('#previous').onclick=()=>{pause();index=Math.max(0,index-1);render();};
  document.querySelector('#next').onclick=()=>{pause();index=Math.min(steps.length-1,index+1);render();};
  document.querySelector('#reset').onclick=()=>{pause();index=0;render();};
  document.querySelector('#play').onclick=()=>{
    if(timer){pause();return;}if(index===steps.length-1)index=0;
    render();document.querySelector('#play').textContent='暂停';timer=setInterval(()=>{index++;render();},750);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  render();
})();
