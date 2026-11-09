
https://github.com/eooce

Thank eooce


```bash
echo "root:此处修改为你的root密码" | chpasswd root && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/g' /etc/ssh/sshd_config && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/g' /etc/ssh/sshd_config && sed -i 's|^Include /etc/ssh/sshd_config.d/\*.conf|#&|' /etc/ssh/sshd_config && systemctl restart ssh
```

将 此处修改为你的root密码 替换一个自定义密码，不要带$符号

在networking菜单里开放防火墙

本地ssh软件连接vps安装节点

然后本地使用 Netcatty ssh软件连接ssh

使用ssh工具箱安装节点

ssh综合工具箱
```bash
bash <(curl -Ls ssh_tool.eooce.com)
```


ps: 先在系统工具菜单里设置ipv4优先


2系统更新 -> 10系统工具 -> 10.切换优先ipv4/ipv6 -> 5.BBR -> 20.BBR+fq加速 -> reboot重启 -> 输入k，回车重新打开工具箱 -> 12搭建节点合集 -> 2.老王四合一

