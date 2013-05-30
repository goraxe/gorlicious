
function load_options() {
    var user = localStorage['user'];
    var password = localStorage['password'];

    if(user) {
        document.getElementById('username').value = user;
    }
    if(password) {
        document.getElementById('password').value = password;
    }
}

function save_options() {

    var user = document.getElementById('username').value;
    var password = document.getElementById('password').value;

    localStorage['user'] = user;
    localStorage['password'] = password;

}



document.addEventListener('DOMContentLoaded', load_options);
document.querySelector('#save').addEventListener('click', save_options);
